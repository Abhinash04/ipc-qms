import { createHash } from 'crypto';
import { IDENTITY_ROLES, identityForRole, allIdentities } from '../../../config/identities.js';
import { getGmailClient } from '../transports/gmailTransport.js';
import * as attachmentStore from '../../attachments/attachmentStore.js';
import { validateFile } from '../../attachments/attachmentPolicy.js';

/**
 * Roles whose mail may start a Query Case. Only the inquirer writes in; mail
 * from IPC staff is correspondence about a case that already exists.
 */
const ENQUIRY_SENDER_ROLES = [IDENTITY_ROLES.INQUIRER];

/** Addresses allowed to open a case, from the identity directory. */
export function enquirySenders() {
  return allIdentities()
    .filter((identity) => ENQUIRY_SENDER_ROLES.includes(identity.role))
    .map((identity) => identity.email.toLowerCase())
    .filter(Boolean);
}

/** The address enquiries must be addressed to — the Front Officer's own. */
export function enquiryRecipient() {
  return (identityForRole(IDENTITY_ROLES.FRONT_OFFICE)?.email || '').toLowerCase();
}

/**
 * What we ask Gmail for.
 *
 * Constrained to a known inquirer AND the Front Officer's own address. This is
 * a real personal inbox: an unqualified `is:unread` search would turn her
 * private mail — a friend's message, a receipt — into Query Cases. Both sides
 * come from the identity directory, so neither address is hard-coded here.
 */
export function inboxQuery({ unreadOnly = true } = {}) {
  const senders = enquirySenders();
  const recipient = enquiryRecipient();

  return [
    'in:inbox',
    unreadOnly ? 'is:unread' : null,
    senders.length ? `from:(${senders.join(' OR ')})` : null,
    recipient ? `to:(${recipient})` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Pull the bare address out of `Name <addr>` or a bare address. */
function bareAddress(header) {
  const raw = String(header || '');
  return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
}

/** Second line of defence, in case the Gmail query ever returns more. */
export function isEnquirySender(fromHeader) {
  return enquirySenders().includes(bareAddress(fromHeader));
}

/**
 * Was this actually addressed to the Front Officer?
 *
 * `To` can carry several recipients, so match on any of them. Mail merely
 * cc'd or bcc'd to her is not an enquiry addressed to IPC.
 */
export function isEnquiryRecipient(toHeader) {
  const wanted = enquiryRecipient();
  if (!wanted) return true;
  return String(toHeader || '')
    .split(',')
    .some((entry) => bareAddress(entry) === wanted);
}

/**
 * The gate every fetched message passes before it can become a Query Case.
 * Applied to what Gmail actually returned, not only to what we asked for.
 */
export function isEligibleEnquiry(message) {
  return isEnquirySender(message?.from) && isEnquiryRecipient(message?.to);
}

const header = (payload, name) =>
  payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

function extractBody(payload) {
  if (!payload) return '';

  const decode = (data) => Buffer.from(data, 'base64').toString('utf8');

  if (payload.body?.data) return decode(payload.body.data);

  const plain = (payload.parts || []).find((part) => part.mimeType === 'text/plain');
  if (plain?.body?.data) return decode(plain.body.data);

  for (const part of payload.parts || []) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

/**
 * Attachment METADATA only — name, type, size. The file bytes are never
 * downloaded or stored; `attachmentId` is the handle Gmail would need to fetch
 * one later.
 */
function extractAttachments(payload, found = []) {
  for (const part of payload?.parts || []) {
    if (part.filename) {
      found.push({
        id: part.body?.attachmentId || null,
        name: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        sizeKb: Math.max(1, Math.round((part.body?.size || 0) / 1024)),
      });
    }
    if (part.parts) extractAttachments(part, found);
  }
  return found;
}

function toMailboxMessage(message, recipient) {
  const payload = message.payload || {};

  return {
    mailboxMessageId: message.id,
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    to: header(payload, 'To') || recipient,
    from: header(payload, 'From'),
    cc: header(payload, 'Cc') ? header(payload, 'Cc').split(',').map((s) => s.trim()) : [],
    bcc: [],
    subject: header(payload, 'Subject') || '(no subject)',
    body: extractBody(payload),
    attachments: extractAttachments(payload),
    receivedAt: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString(),
    ingested: !(message.labelIds || []).includes('UNREAD'),
  };
}

/**
 * Deterministic id from (messageId, providerAttachmentId). This is what makes
 * re-polling the same mail idempotent without a lookup index: fetching the
 * same Gmail attachment twice writes the same id, so `saveWithId` just
 * overwrites bytes that are already identical.
 */
function deterministicAttachmentId(seed) {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `att_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Downloads real bytes for a message's attachments and persists them to disk,
 * turning `extractAttachments`'s provider metadata into records the rest of
 * the app can actually preview/download/forward. A failure on any single
 * attachment (bad type, download error, oversize) is caught and recorded on
 * that entry rather than failing the whole poll — one bad attachment on one
 * email must not stop every other enquiry from being ingested.
 */
async function materialiseAttachments(gmail, messageId, attachments) {
  return Promise.all(
    attachments.map(async (att) => {
      if (!att.id) {
        return { ...att, attachmentId: null, materializeError: 'no attachmentId on the Gmail part' };
      }

      const check = validateFile({ filename: att.name, mimeType: att.mimeType, size: null });
      if (!check.ok) {
        return { ...att, attachmentId: null, materializeError: check.reason };
      }

      try {
        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: att.id,
        });
        // Gmail's attachment payload is base64url, same as the raw message —
        // unlike extractBody's stale plain 'base64' decode (a pre-existing,
        // separate issue, left untouched here).
        const buffer = Buffer.from(response.data?.data || '', 'base64url');
        const id = deterministicAttachmentId(`${messageId}:${att.id}`);
        const meta = await attachmentStore.saveWithId(id, {
          buffer,
          filename: att.name,
          mimeType: att.mimeType,
          providerMessageId: messageId,
          providerAttachmentId: att.id,
        });
        return { ...att, attachmentId: meta.attachmentId, sizeKb: Math.max(1, Math.round(meta.size / 1024)) };
      } catch (error) {
        return { ...att, attachmentId: null, materializeError: error.message };
      }
    }),
  );
}

const ROLE = IDENTITY_ROLES.FRONT_OFFICE;

async function deliver() {
  throw new Error(
    'gmailInboxReader is read-only — send a real email instead of depositing one. ' +
      'Use MAILBOX_SOURCE=auto for the in-memory/Mongo mailbox.',
  );
}

/**
 * `client` is the test seam — the same injection pattern used for the dispatch
 * and forward senders. Production callers never pass it.
 */
async function list(recipient, { unreadOnly = false, max = 25, client = null } = {}) {
  const gmail = client || getGmailClient(ROLE);
  const address = recipient || identityForRole(ROLE)?.email;

  const listed = await gmail.users.messages.list({
    userId: 'me',
    q: inboxQuery({ unreadOnly }),
    maxResults: max,
  });

  const ids = listed.data.messages || [];
  const messages = await Promise.all(
    ids.map(async ({ id }) => {
      const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      return toMailboxMessage(full.data, address);
    }),
  );

  const eligible = messages
    // Never hand back mail that may not open a case, whatever the search
    // returned. The Gmail query is the first filter, this is the binding one.
    .filter(isEligibleEnquiry)
    // Oldest first, matching the other stores' insertion ordering.
    .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

  // Bytes are only downloaded for mail that may actually open a case — after
  // eligibility filtering, not before.
  return Promise.all(
    eligible.map(async (message) => {
      if (!message.attachments?.length) return message;
      const materialised = await materialiseAttachments(gmail, message.providerMessageId, message.attachments);
      return { ...message, attachments: materialised };
    }),
  );
}

async function markIngested(recipient, mailboxMessageId, { client = null } = {}) {
  const gmail = client || getGmailClient(ROLE);

  const updated = await gmail.users.messages.modify({
    userId: 'me',
    id: mailboxMessageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });

  if (!updated?.data) return null;
  return toMailboxMessage(updated.data, recipient || identityForRole(ROLE)?.email);
}

/**
 * Unlike `deliver` and `reset`, this one does touch the real account — but it
 * only moves the message to Trash, where Gmail keeps it recoverable for 30
 * days. Nothing is permanently destroyed.
 */
async function remove(recipient, mailboxMessageId, { client = null } = {}) {
  const gmail = client || getGmailClient(ROLE);

  const trashed = await gmail.users.messages.trash({
    userId: 'me',
    id: mailboxMessageId,
  });

  if (!trashed?.data) return null;
  return toMailboxMessage(trashed.data, recipient || identityForRole(ROLE)?.email);
}

async function reset() {
  throw new Error('gmailInboxReader.reset is not supported: it would modify a real Gmail account');
}

async function stats() {
  const messages = await list(null, { unreadOnly: false });
  return { recipients: 1, messages: messages.length };
}

export { deliver, list, markIngested, remove, reset, stats, toMailboxMessage, extractAttachments, materialiseAttachments };
export const backend = 'gmail';
