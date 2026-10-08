import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nicConfig from '../../../config/nicConfig.js';
import { getPassword, redact } from './credentials.js';

const READ_ONLY = true;

function buildClient() {
  return async (password) =>
    new ImapFlow({
      host: nicConfig.imapHost,
      port: nicConfig.imapPort,
      secure: nicConfig.imapSecure,
      auth: { user: nicConfig.email, pass: password },
      logger: false,
      emitLogs: false,
      socketTimeout: nicConfig.timeoutMs,
      greetingTimeout: nicConfig.timeoutMs,
    });
}

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
    attachments: (parsed.attachments || []).map((a) => ({
      filename: a.filename || null,
      contentType: a.contentType || null,
      size: a.size ?? null,
    })),
  };
}

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
    await client.connect();
  } catch (error) {
    return {
      ok: false,
      stage: stageForError(error),
      error: redact(error?.responseText || error?.message || String(error), password),
    };
  }

  try {
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
    } catch {}
  }
}
