import tls from 'tls';
const TIMEOUT_MS = 12000;
const CANDIDATES = [
  {
    label: 'A — mail.gov.in',
    imap: { host: 'imap.mail.gov.in', port: 993 },
    smtp: { host: 'smtp.mail.gov.in', port: 465 },
  },
  {
    label: 'B — mgovcloud.in (NICeMail infrastructure)',
    imap: { host: 'imap.mgovcloud.in', port: 993 },
    smtp: { host: 'smtp.mgovcloud.in', port: 465 },
  },
];

const redact = (text, secret) =>
  secret ? String(text).split(secret).join('«redacted»') : String(text);

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a TTY — use NIC_APP_PASSWORD_FILE instead'));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buffer = '';
    const finish = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(buffer);
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
      return undefined;
    };

    stdin.on('data', onData);
  });
}

async function readPassword() {
  const file = process.env.NIC_APP_PASSWORD_FILE;
  if (file) {
    const { readFile } = await import('fs/promises');
    return (await readFile(file, 'utf8')).trim();
  }
  if (!process.stdin.isTTY) return '';
  return promptHidden('  App-specific password (input hidden, not stored): ');
}

function connectTls({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => resolve(wrap(socket)));
    socket.setTimeout(TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`timed out after ${TIMEOUT_MS}ms`));
    });
    socket.once('error', reject);
  });
}

function wrap(socket) {
  let buffer = '';
  const waiters = [];

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].test(buffer)) {
        const { resolve } = waiters.splice(i, 1)[0];
        const taken = buffer;
        buffer = '';
        resolve(taken);
      }
    }
  });

  return {
    socket,
    send(line) {
      socket.write(`${line}\r\n`);
    },
    until(test) {
      return new Promise((resolve, reject) => {
        if (test(buffer)) {
          const taken = buffer;
          buffer = '';
          resolve(taken);
          return;
        }
        const waiter = { test, resolve };
        waiters.push(waiter);
        socket.once('error', reject);
        setTimeout(() => reject(new Error('timed out waiting for server response')), TIMEOUT_MS);
      });
    },
    close() {
      socket.destroy();
    },
  };
}

async function probeReachable({ host, port }) {
  try {
    const conn = await connectTls({ host, port });
    const greeting = await conn.until((b) => b.includes('\n'));
    conn.close();
    return { ok: true, greeting: greeting.trim().split('\n')[0] };
  } catch (error) {
    const code = error.code || '';
    let hint = error.message;
    if (code === 'ENOTFOUND') hint = 'DNS does not resolve this hostname';
    else if (code === 'ECONNREFUSED') hint = 'connection refused';
    else if (code === 'ETIMEDOUT' || /timed out/.test(hint)) {
      hint = 'timed out — often an IP/network restriction rather than an outage';
    }
    return { ok: false, error: hint };
  }
}
const imapQuote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function probeImapLogin({ host, port }, email, password) {
  let conn;
  try {
    conn = await connectTls({ host, port });
    await conn.until((b) => /^\* (OK|PREAUTH|BYE)/m.test(b));

    conn.send(`a1 LOGIN ${imapQuote(email)} ${imapQuote(password)}`);
    const login = await conn.until((b) => /^a1 (OK|NO|BAD)/m.test(b));

    if (!/^a1 OK/m.test(login)) {
      const line = (login.match(/^a1 (NO|BAD).*/m) || [login])[0].trim();
      return { ok: false, error: redact(line, password) };
    }
    conn.send('a2 EXAMINE INBOX');
    const examine = await conn.until((b) => /^a2 (OK|NO|BAD)/m.test(b));
    const exists = (examine.match(/^\* (\d+) EXISTS/m) || [])[1];
    const uidValidity = (examine.match(/UIDVALIDITY (\d+)/) || [])[1];

    conn.send('a3 LOGOUT');
    return { ok: true, exists, uidValidity };
  } catch (error) {
    return { ok: false, error: redact(error.message, password) };
  } finally {
    if (conn) conn.close();
  }
}

async function probeSmtpAuth({ host, port }, email, password) {
  let conn;
  try {
    conn = await connectTls({ host, port });
    await conn.until((b) => /^220/m.test(b));

    conn.send('EHLO qms-preflight');
    const ehlo = await conn.until((b) => /^250[ ]/m.test(b));
    const mechanisms = (ehlo.match(/^250[- ]AUTH (.*)$/m) || [])[1] || '(none advertised)';

    if (!/AUTH/i.test(ehlo)) {
      conn.send('QUIT');
      return { ok: false, mechanisms, error: 'server advertises no AUTH mechanisms' };
    }

    conn.send('AUTH LOGIN');
    await conn.until((b) => /^334/m.test(b));
    conn.send(Buffer.from(email).toString('base64'));
    await conn.until((b) => /^(334|535|5\d\d)/m.test(b));
    conn.send(Buffer.from(password).toString('base64'));
    const result = await conn.until((b) => /^(235|5\d\d|4\d\d)/m.test(b));

    conn.send('QUIT'); 
    if (/^235/m.test(result)) return { ok: true, mechanisms };
    return { ok: false, mechanisms, error: redact(result.trim().split('\n')[0], password) };
  } catch (error) {
    return { ok: false, error: redact(error.message, password) };
  } finally {
    if (conn) conn.close();
  }
}

function diagnoseAuthFailure(message) {
  const text = String(message).toLowerCase();

  if (/otp|kavach|two[- ]factor|2fa|second factor|one[- ]time/.test(text)) {
    return {
      verdict: 'BLOCKED',
      note:
        'The server is asking for a rotating one-time code. That is the legacy\n' +
        '     email.gov.in/Kavach model, which an unattended backend CANNOT satisfy.\n' +
        '     The account must be migrated to NICeMail, or granted a policy exception,\n' +
        '     before this integration is possible.',
    };
  }
  if (/disabled|not enabled|not allowed|denied|permission|policy/.test(text)) {
    return {
      verdict: 'NOT ENABLED',
      note:
        'IMAP/SMTP looks disabled for this account or barred by org policy.\n' +
        '     Enable it in webmail (Settings → Mail Accounts → IMAP Access) and, if it\n' +
        '     is unavailable there, request it via support@gov.in / your Delegated Admin.',
    };
  }
  if (/auth|credential|password|invalid|login|535/.test(text)) {
    return {
      verdict: 'CREDENTIAL REJECTED',
      note:
        'If you used the WEBMAIL LOGIN PASSWORD, that is expected under MFA —\n' +
        '     generate an application-specific password (Security → App Passwords)\n' +
        '     and use that instead.',
    };
  }
  return { verdict: 'FAILED', note: 'See the server response above.' };
}

async function preflight() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  const email = (emailArg ? emailArg.slice('--email='.length) : process.env.NIC_EMAIL || '').trim();

  console.log('\nNIC eMail preflight — READ-ONLY. No message is composed, sent, or modified.');
  console.log('Run this from the DEPLOYMENT HOST; a laptop pass proves nothing about the server.\n');
  console.log('── Reachability (TLS handshake)');
  const reachable = new Map();
  for (const candidate of CANDIDATES) {
    for (const kind of ['imap', 'smtp']) {
      const endpoint = candidate[kind];
      const result = await probeReachable(endpoint);
      const target = `${endpoint.host}:${endpoint.port}`.padEnd(28);
      if (result.ok) {
        console.log(`   ✓ ${target} ${result.greeting.slice(0, 60)}`);
        reachable.set(`${candidate.label}/${kind}`, true);
      } else {
        console.log(`   ✗ ${target} ${result.error}`);
      }
    }
  }

  if (reachable.size === 0) {
    console.error('\nFAILED — no NIC endpoint is reachable from this host.');
    console.error('Likely an outbound firewall rule, or IMAP/SMTP restricted to NICNET.');
    console.error('Ask NIC whether this host\'s public IP must be allowlisted.\n');
    process.exit(1);
  }

  if (!email) {
    console.log('\nNo address supplied, so the authentication check was skipped.');
    console.log('Re-run with:  npm run nic:preflight -- --email=you@gov.in\n');
    return;
  }

  console.log(`\n── Authentication as ${email}`);
  const password = await readPassword();
  if (!password) {
    console.log('   ○ No password supplied — set NIC_APP_PASSWORD_FILE or run in a terminal.');
    console.log('     Use the APPLICATION-SPECIFIC password, not the webmail login password.\n');
    return;
  }

  const failures = [];
  let working = null;

  for (const candidate of CANDIDATES) {
    if (!reachable.has(`${candidate.label}/imap`)) continue;
    console.log(`\n   ${candidate.label}`);

    const imap = await probeImapLogin(candidate.imap, email, password);
    if (imap.ok) {
      console.log(`   ✓ IMAP LOGIN accepted — INBOX has ${imap.exists ?? '?'} messages`);
      console.log(`     UIDVALIDITY ${imap.uidValidity ?? '?'} (the sync cursor anchors to this)`);
    } else {
      console.log(`   ✗ IMAP LOGIN rejected: ${imap.error}`);
      failures.push(imap.error);
    }

    let smtp = { ok: false, error: 'skipped — SMTP endpoint unreachable' };
    if (reachable.has(`${candidate.label}/smtp`)) {
      smtp = await probeSmtpAuth(candidate.smtp, email, password);
      if (smtp.ok) console.log(`   ✓ SMTP AUTH accepted — mechanisms: ${smtp.mechanisms}`);
      else console.log(`   ✗ SMTP AUTH failed: ${smtp.error}`);
    }

    if (imap.ok && smtp.ok && !working) working = candidate;
  }

  console.log('\n────────────────────────────────────────');
  if (working) {
    console.log(`PREFLIGHT PASSED using ${working.label}`);
    console.log(`  IMAP  ${working.imap.host}:${working.imap.port}`);
    console.log(`  SMTP  ${working.smtp.host}:${working.smtp.port}`);
    console.log('\nThis mailbox supports unattended IMAP/SMTP with an app password —');
    console.log('the Phase 0 gate is met and implementation can proceed.');
    console.log('\nStill required before writing code (see the plan, §3):');
    console.log('  • NIC confirmation that server-application access is permitted');
    console.log('  • Sending / recipient / attachment limits');
    console.log('  • Whether this same result holds from the production host');
    console.log('  • Backend authN/authZ (Phase 1) — it is a hard blocker\n');
    return;
  }

  const { verdict, note } = diagnoseAuthFailure(failures.join(' ') || 'unknown');
  console.error(`PREFLIGHT ${verdict} — no endpoint pair authenticated.`);
  console.error(`\n  → ${note}\n`);
  console.error('Nothing was sent and no mail was modified.\n');
  process.exit(1);
}

preflight().catch((error) => {
  console.error(`\nPreflight error: ${error.message}\n`);
  process.exit(1);
});
