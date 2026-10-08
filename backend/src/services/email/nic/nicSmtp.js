import nodemailer from 'nodemailer';
import nicConfig from '../../../config/nicConfig.js';
import { getPassword, redact } from './credentials.js';

function buildTransport(password) {
  return nodemailer.createTransport({
    host: nicConfig.smtpHost,
    port: nicConfig.smtpPort,
    secure: nicConfig.smtpSecure,
    auth: { user: nicConfig.email, pass: password },
    connectionTimeout: nicConfig.timeoutMs,
    greetingTimeout: nicConfig.timeoutMs,
    socketTimeout: nicConfig.timeoutMs,
    logger: false,
    debug: false,
  });
}

function stageForError(error) {
  if (error?.code === 'EAUTH') return 'authenticate';
  if (String(error?.responseCode || '') === '535') return 'authenticate';
  if (/authentication failed|AUTH/i.test(String(error?.message || ''))) return 'authenticate';
  return 'connect';
}

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
      from: from ? `${from} <${nicConfig.email}>` : nicConfig.email,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      text,
      attachments: attachments.length ? attachments : undefined,
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
    transport.close?.();
  }
}
