import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import env from '../../../config/env.js';
import { identityForRole, IDENTITY_ROLES } from '../../../config/identities.js';
import { DELIVERY, errorCode, errorStatus, labelDelivery } from '../delivery.js';

const clients = new Map();

/**
 * Every Gmail call gives up after this long. Without a ceiling a request stalls
 * for as long as the operating system's DNS retries last — the live test showed
 * 22.9 s sends and 46 s inbox reads while a Wi-Fi resolver was failing. A send
 * that times out is treated as UNCERTAIN by the outbox and checked against the
 * Sent folder before anything is sent again; the outbox's lease is longer than
 * this so a slow send can never be mistaken for a dead one.
 */
export const GMAIL_TIMEOUT_MS = 30000;

/**
 * An absent message in the Sent folder proves nothing until Gmail's search
 * index has caught up, which can take a few seconds after a send.
 */
const SENT_SEARCH_SETTLE_MS = 60000;

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

  const client = google.gmail({ version: 'v1', auth, timeout: GMAIL_TIMEOUT_MS });
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
    // Set by the outbox, one per attempt, so a send whose outcome is unknown
    // can be looked up in the Sent folder — see `reconcile` below.
    message.messageIdHeader ? `Message-ID: <${message.messageIdHeader}>` : null,
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

/**
 * gaxios attaches the request `config` to every error it raises. Such an error
 * came from the network, where an error with no code and no status proves
 * nothing about delivery — so it is labelled UNCERTAIN rather than left to be
 * read as a local failure. Codes and statuses are classified in delivery.js.
 */
function labelHttpFailure(error) {
  if (error && typeof error === 'object' && 'config' in error && !errorCode(error) && errorStatus(error) === null) {
    return labelDelivery(error, DELIVERY.UNCERTAIN);
  }
  return error;
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
    // unthreaded send rather than losing the message — the first attempt was
    // refused outright, so nothing went out. Anything else is a real failure
    // and stays loud.
    if (!message.providerThreadId || !isUnusableThread(error)) throw labelHttpFailure(error);
    try {
      res = await attempt(null);
    } catch (retryError) {
      throw labelHttpFailure(retryError);
    }
  }

  return {
    providerMessageId: res.data.id,
    providerThreadId: res.data.threadId,
    transport: 'gmail',
    sentAsRole: asRole,
  };
}

const headerOf = (payload, name) =>
  (payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/**
 * Did an UNCERTAIN send actually go out? Asks the Front Office's own Sent folder.
 *
 * First by the Message-ID the outbox put on that attempt. Then, in case Gmail
 * replaced the header, by recipient and time window, comparing each candidate's
 * exact Subject — the case id is in every subject, and each case sends each
 * kind of email once. Uses the read scope the inbox poll already needs.
 *
 * @returns {{ verdict: 'SENT'|'NOT_SENT'|'UNKNOWN', providerMessageId?, providerThreadId? }}
 */
export async function reconcile(
  dispatch,
  { asRole = IDENTITY_ROLES.FRONT_OFFICE, client = null, now = Date.now() } = {},
) {
  const gmail = client || getGmailClient(asRole);
  const found = (message) => ({ verdict: 'SENT', providerMessageId: message.id, providerThreadId: message.threadId || null });

  if (dispatch.rfcMessageId) {
    const byId = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent rfc822msgid:${dispatch.rfcMessageId}`,
      maxResults: 1,
    });
    const hit = byId.data.messages?.[0];
    if (hit) return found(hit);
  }

  const startedAt = Date.parse(dispatch.attemptedAt || dispatch.createdAt || '') || now;
  const recipient = dispatch.recipients?.[0];

  if (recipient && dispatch.subject) {
    const after = Math.floor((startedAt - 60000) / 1000);
    const candidates = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent to:${recipient} after:${after}`,
      maxResults: 10,
    });

    for (const candidate of candidates.data.messages || []) {
      const meta = await gmail.users.messages.get({
        userId: 'me',
        id: candidate.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'Message-ID'],
      });
      const subject = headerOf(meta.data.payload, 'Subject');
      const messageId = headerOf(meta.data.payload, 'Message-ID');
      if (subject === dispatch.subject || (dispatch.rfcMessageId && messageId.includes(dispatch.rfcMessageId))) {
        return found(candidate);
      }
    }
  }

  return { verdict: now - startedAt >= SENT_SEARCH_SETTLE_MS ? 'NOT_SENT' : 'UNKNOWN' };
}

export function reset() {
  clients.clear();
}

export const name = 'gmail';
