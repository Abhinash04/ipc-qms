import nicConfig, { validateNicConfig } from '../../../config/nicConfig.js';
import { describeCredential } from './credentials.js';
import { readMessages } from './nicImap.js';
import { sendMessage } from './nicSmtp.js';

const sameAddress = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function configError() {
  const errors = validateNicConfig();
  if (!errors.length) return null;
  return { ok: false, stage: 'config', error: `Invalid NICeMail configuration: ${errors.join('; ')}` };
}

export async function read_nicemail({ limit = 1, createClient = null } = {}) {
  const bad = configError();
  if (bad) return bad;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1, 1), 20);
  return readMessages({ limit: safeLimit, createClient });
}

export async function send_nicemail({
  to = nicConfig.testRecipient,
  subject,
  body,
  createTransport = null,
} = {}) {
  const bad = configError();
  if (bad) return bad;

  if (!nicConfig.testRecipient) {
    return {
      ok: false,
      stage: 'config',
      error: 'NIC_TEST_RECIPIENT is not set — refusing to send without an allow-listed recipient.',
    };
  }

  if (!sameAddress(to, nicConfig.testRecipient)) {
    return {
      ok: false,
      stage: 'config',
      error:
        `Refusing to send to "${to}". This action may only send to the configured ` +
        `NIC_TEST_RECIPIENT. Change that variable if a different recipient is intended.`,
    };
  }

  const stamp = new Date().toISOString();

  return sendMessage({
    to: nicConfig.testRecipient,
    subject: subject || `QMS NICeMail connectivity test ${stamp}`,
    text:
      body ||
      [
        'This is an automated connectivity test from the IPC QMS backend.',
        '',
        `Sent at: ${stamp}`,
        'No action is required.',
      ].join('\n'),
    createTransport,
  });
}

export function describeNicSetup() {
  return {
    mailbox: nicConfig.email || null,
    imap: nicConfig.imapHost ? `${nicConfig.imapHost}:${nicConfig.imapPort}` : null,
    smtp: nicConfig.smtpHost ? `${nicConfig.smtpHost}:${nicConfig.smtpPort}` : null,
    folder: nicConfig.mailbox,
    testRecipient: nicConfig.testRecipient || null,
    credential: describeCredential(),
    configErrors: validateNicConfig(),
  };
}
