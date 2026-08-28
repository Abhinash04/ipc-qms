import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import env from '../../../config/env.js';
import { identityForRole, IDENTITY_ROLES } from '../../../config/identities.js';

const clients = new Map();

export function getGmailClient(role = IDENTITY_ROLES.INQUIRER) {
  if (clients.has(role)) return clients.get(role);

  const identity = identityForRole(role);
  if (!identity) {
    throw new Error(`Gmail transport: no identity is configured for role "${role}"`);
  }

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) {
    throw new Error(
      'Gmail transport selected but the OAuth app is not configured. ' +
        'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or use EMAIL_TRANSPORT=mock.',
    );
  }

  if (!identity.refreshToken) {
    throw new Error(
      `Cannot send as ${identity.name} <${identity.email}> — ` +
        `GMAIL_REFRESH_TOKEN_${role} is not set. Each account must authorise itself; ` +
        'another stakeholder\'s token must never be used to send on their behalf.',
    );
  }

  const auth = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: identity.refreshToken });

  const client = google.gmail({ version: 'v1', auth });
  clients.set(role, client);
  return client;
}

export async function authenticatedAddress(role) {
  const gmail = getGmailClient(role);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

const asList = (value) => (Array.isArray(value) ? value.join(', ') : value || '');

// eslint-disable-next-line no-control-regex -- deliberately includes the ASCII control range
const isAscii = (str) => /^[\x00-\x7F]*$/.test(str || '');

/** ASCII-safe fallback for the plain (non-`*=`) filename parameter. */
const asciiFilename = (name) => String(name || 'attachment').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");

/** RFC 2045 §6.8: base64 body lines must not exceed 76 characters. */
const wrapBase64 = (base64) => base64.replace(/(.{76})/g, '$1\r\n');

function baseHeaders(message) {
  return [
    `From: ${message.from}`,
    `To: ${asList(message.to)}`,
    message.cc?.length ? `Cc: ${asList(message.cc)}` : null,
    message.bcc?.length ? `Bcc: ${asList(message.bcc)}` : null,
    `Subject: ${message.subject || '(no subject)'}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);
}

/**
 * With no attachments this produces the exact single-part output the
 * original implementation did, byte for byte — pinned by a regression test.
 * With attachments it switches to `multipart/mixed`: one text/plain part for
 * the body, then one base64 part per attachment. Non-ASCII filenames use the
 * RFC 5987/6266 `filename*=UTF-8''…` form alongside an ASCII fallback so both
 * old and new mail clients render a sane name.
 *
 * This function stays pure — it only ever receives `{filename, mimeType,
 * content: Buffer}` records that emailService has already resolved from disk;
 * it does no file I/O of its own.
 */
export function buildRawMessage(message) {
  const attachments = (message.attachments || []).filter((att) => att && Buffer.isBuffer(att.content));

  let raw;
  if (attachments.length === 0) {
    const headers = [...baseHeaders(message), 'Content-Type: text/plain; charset="UTF-8"'];
    raw = `${headers.join('\r\n')}\r\n\r\n${message.body || ''}`;
  } else {
    const boundary = `qms_${randomBytes(16).toString('hex')}`;
    const headers = [...baseHeaders(message), `Content-Type: multipart/mixed; boundary="${boundary}"`];

    const bodyPart = [`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', '', message.body || ''].join(
      '\r\n',
    );

    const attachmentParts = attachments.map((att) => {
      const ascii = asciiFilename(att.filename);
      const utf8Star = isAscii(att.filename) ? '' : `; filename*=UTF-8''${encodeURIComponent(att.filename)}`;
      return [
        `--${boundary}`,
        `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${ascii}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${ascii}"${utf8Star}`,
        '',
        wrapBase64(att.content.toString('base64')),
      ].join('\r\n');
    });

    raw = [headers.join('\r\n'), '', bodyPart, ...attachmentParts, `--${boundary}--`, ''].join('\r\n');
  }

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A thread id is private to the mailbox that produced it. Replying into one
 * that belongs to another account is rejected, and Gmail is inconsistent about
 * whether that reads as 400 or 404 — so accept both.
 */
function isUnusableThread(error) {
  const status = error?.status ?? error?.code ?? error?.response?.status;
  return status === 400 || status === 404;
}

export async function send(
  message,
  { asRole = IDENTITY_ROLES.INQUIRER, client = null } = {},
) {
  const gmail = client || getGmailClient(asRole);
  const raw = buildRawMessage(message);

  const attempt = (threadId) =>
    gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    });

  let res;
  try {
    res = await attempt(message.providerThreadId);
  } catch (error) {
    // Threading is a presentation nicety; delivery is the job. Fall back to an
    // unthreaded send rather than losing the message. Anything else is a real
    // failure and stays loud.
    if (!message.providerThreadId || !isUnusableThread(error)) throw error;
    res = await attempt(null);
  }

  return {
    providerMessageId: res.data.id,
    providerThreadId: res.data.threadId,
    transport: 'gmail',
    sentAsRole: asRole,
  };
}

export function reset() {
  clients.clear();
}

export const name = 'gmail';
