import nicConfig, { validateNicConfig } from '../../../config/nicConfig.js';
import { describeCredential } from './credentials.js';
import { readMessages } from './nicImap.js';
import { sendMessage } from './nicSmtp.js';

/**
 * The two NICeMail agent actions.
 *
 * Both return the same shape so a caller can report the four verification
 * levels separately rather than collapsing them into one boolean:
 *
 *   { ok, stage, data, error }
 *
 *   read stages: connect → authenticate → open_mailbox → fetch
 *   send stages: connect → authenticate → submit
 *
 * `stage` is the furthest point reached. On failure it names the step that
 * failed, so "the server refused our password" is never reported as "NICeMail
 * is unreachable", and neither is ever reported as "the mail was delivered".
 */

const sameAddress = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Config problems are caught before a socket is opened. */
function configError() {
  const errors = validateNicConfig();
  if (!errors.length) return null;
  return { ok: false, stage: 'config', error: `Invalid NICeMail configuration: ${errors.join('; ')}` };
}

/**
 * read_nicemail — fetch the newest message(s) from the NIC mailbox.
 *
 * Read-only: the mailbox is opened with readOnly, so this cannot even mark a
 * message as seen.
 */
export async function read_nicemail({ limit = 1, createClient = null } = {}) {
  const bad = configError();
  if (bad) return bad;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1, 1), 20);
  return readMessages({ limit: safeLimit, createClient });
}

/**
 * send_nicemail — send one message through NIC SMTP.
 *
 * Refuses any recipient other than NIC_TEST_RECIPIENT. This action exists to
 * verify the transport, not to correspond: without the guard it would be a
 * general-purpose send capability on an official government mailbox, callable
 * by anything that can reach it. The check is here rather than in the route so
 * it holds however the action is invoked.
 */
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

/** Non-secret view of the current setup, for diagnostics and the API. */
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
