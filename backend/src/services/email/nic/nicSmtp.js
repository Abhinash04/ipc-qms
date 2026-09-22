import nodemailer from 'nodemailer';
import nicConfig from '../../../config/nicConfig.js';
import { getPassword, redact } from './credentials.js';

/**
 * Sending through NICeMail over SMTP.
 *
 * `verify()` is called before `sendMail()` on purpose. Nodemailer would happily
 * do both inside one call, but then a rejected password and a rejected message
 * are indistinguishable in the result — and telling those apart is the entire
 * question this module exists to answer.
 */

function buildTransport(password) {
  return nodemailer.createTransport({
    host: nicConfig.smtpHost,
    port: nicConfig.smtpPort,
    secure: nicConfig.smtpSecure,
    auth: { user: nicConfig.email, pass: password },
    connectionTimeout: nicConfig.timeoutMs,
    greetingTimeout: nicConfig.timeoutMs,
    socketTimeout: nicConfig.timeoutMs,
    // Nodemailer's logger prints the AUTH exchange. Both stay off.
    logger: false,
    debug: false,
  });
}

/** Nodemailer tags auth rejections with an EAUTH code; 535 is the SMTP reply. */
function stageForError(error) {
  if (error?.code === 'EAUTH') return 'authenticate';
  if (String(error?.responseCode || '') === '535') return 'authenticate';
  if (/authentication failed|AUTH/i.test(String(error?.message || ''))) return 'authenticate';
  return 'connect';
}

/**
 * Send one message.
 *
 * Returns `{ ok, stage, data, error }`. `stage` is the furthest point reached:
 * connect → authenticate → submit.
 *
 * `createTransport` is the injection seam for tests; production never passes it.
 */
export async function sendMessage({
  to,
  subject,
  text,
  from = null,
  cc = [],
  bcc = [],
  attachments = [],
  messageId = null,
  createTransport = null,
} = {}) {
  const password = await getPassword();

  if (!password) {
    return {
      ok: false,
      stage: 'authenticate',
      error: 'No NICeMail credential configured. Set NIC_APP_PASSWORD or NIC_APP_PASSWORD_FILE.',
    };
  }

  const transport = (createTransport || buildTransport)(password);

  try {
    // Connect + AUTH only. Nothing is queued for delivery by this call.
    await transport.verify();
  } catch (error) {
    return {
      ok: false,
      stage: stageForError(error),
      error: redact(error?.response || error?.message || String(error), password),
    };
  }

  try {
    const info = await transport.sendMail({
      // The envelope sender is always the authenticated mailbox — NIC rejects a
      // MAIL FROM it did not authenticate. `from` only sets the display name,
      // so a QMS role can be identified without spoofing the address.
      from: from ? `${from} <${nicConfig.email}>` : nicConfig.email,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      text,
      attachments: attachments.length ? attachments : undefined,
      // The outbox's per-attempt id, so a send whose outcome is unknown can be
      // found by it later. Nodemailer generates one when this is absent.
      messageId: messageId ? `<${messageId}>` : undefined,
    });

    return {
      ok: true,
      stage: 'submit',
      data: {
        messageId: info.messageId || null,
        response: redact(info.response || '', password),
        accepted: info.accepted || [],
        rejected: info.rejected || [],
      },
    };
  } catch (error) {
    return {
      ok: false,
      stage: 'submit',
      error: redact(error?.response || error?.message || String(error), password),
    };
  } finally {
    // Frees the pooled socket; nodemailer leaves the process alive otherwise.
    transport.close?.();
  }
}
