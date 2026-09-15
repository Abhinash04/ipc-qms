import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nicConfig from '../../../config/nicConfig.js';
import { getPassword, redact } from './credentials.js';

/**
 * Reading from the NICeMail mailbox over IMAP.
 *
 * Scope is deliberately narrow: connect, authenticate, open a mailbox, fetch
 * the newest messages, parse them. No flag changes, no move, no delete, no
 * APPEND — this module cannot modify the mailbox.
 */

/** `\Seen` is never added: opening the mailbox read-only keeps this a true read. */
const READ_ONLY = true;

function buildClient() {
  return async (password) =>
    new ImapFlow({
      host: nicConfig.imapHost,
      port: nicConfig.imapPort,
      secure: nicConfig.imapSecure,
      auth: { user: nicConfig.email, pass: password },
      // imapflow's default logger writes every IMAP command to stdout, which
      // includes the LOGIN line carrying the password. Both must stay off.
      logger: false,
      emitLogs: false,
      socketTimeout: nicConfig.timeoutMs,
      greetingTimeout: nicConfig.timeoutMs,
    });
}

/**
 * Did this failure happen while authenticating, or before we ever got that far?
 *
 * The distinction is the whole point of the exercise: a rejected password
 * means the server is reachable and the integration is sound, whereas a
 * connect failure means we never spoke to NIC at all.
 */
function stageForError(error) {
  if (error?.authenticationFailed) return 'authenticate';
  const text = String(error?.message || '');
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE/i.test(text)) {
    return 'authenticate';
  }
  return 'connect';
}

function toMessage(parsed, uid) {
  const addresses = (field) => (field?.value || []).map((a) => a.address).filter(Boolean);

  return {
    uid,
    messageId: parsed.messageId || null,
    from: parsed.from?.text || null,
    fromAddresses: addresses(parsed.from),
    to: parsed.to?.text || null,
    toAddresses: addresses(parsed.to),
    cc: parsed.cc?.text || null,
    subject: parsed.subject || '(no subject)',
    date: parsed.date ? parsed.date.toISOString() : null,
    text: parsed.text || '',
    hasHtml: Boolean(parsed.html),
    // Metadata only. Bytes are not stored anywhere by this module.
    attachments: (parsed.attachments || []).map((a) => ({
      filename: a.filename || null,
      contentType: a.contentType || null,
      size: a.size ?? null,
    })),
  };
}

/**
 * Fetch the newest `limit` messages.
 *
 * `createClient` is the injection seam — the same `{ client = null }` pattern
 * the Gmail modules use — so tests never open a socket. Production callers
 * never pass it.
 *
 * Returns `{ ok, stage, data, error }`. `stage` is the furthest point reached:
 * connect → authenticate → open_mailbox → fetch.
 */
export async function readMessages({ limit = 1, createClient = null } = {}) {
  const password = await getPassword();

  if (!password) {
    return {
      ok: false,
      stage: 'authenticate',
      error: 'No NICeMail credential configured. Set NIC_APP_PASSWORD or NIC_APP_PASSWORD_FILE.',
    };
  }

  const make = createClient || buildClient();
  let client;
  let stage = 'connect';

  try {
    client = await make(password);
    // ImapFlow.connect() performs the TLS handshake and the LOGIN together, so
    // the stage is resolved from the error rather than between two awaits.
    await client.connect();
  } catch (error) {
    return {
      ok: false,
      stage: stageForError(error),
      error: redact(error?.responseText || error?.message || String(error), password),
    };
  }

  try {
    // Connected and authenticated by this point; anything from here on is a
    // mailbox problem, not a credential one.
    stage = 'open_mailbox';
    const lock = await client.getMailboxLock(nicConfig.mailbox, { readOnly: READ_ONLY });
    try {
      const total = client.mailbox?.exists ?? 0;
      stage = 'fetch';

      if (total === 0) {
        return { ok: true, stage, data: { mailbox: nicConfig.mailbox, total, messages: [] } };
      }

      const first = Math.max(1, total - limit + 1);
      const messages = [];

      for await (const message of client.fetch(`${first}:${total}`, { source: true, uid: true })) {
        const parsed = await simpleParser(message.source);
        messages.push(toMessage(parsed, message.uid));
      }

      // Newest first.
      messages.reverse();
      return { ok: true, stage, data: { mailbox: nicConfig.mailbox, total, messages } };
    } finally {
      lock.release();
    }
  } catch (error) {
    return {
      ok: false,
      stage,
      error: redact(error?.responseText || error?.message || String(error), password),
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // A failed logout cannot invalidate a fetch that already succeeded.
    }
  }
}
