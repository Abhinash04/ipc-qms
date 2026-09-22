import { createHash } from 'crypto';
import { IDENTITY_ROLES, identityForRole } from '../../../config/identities.js';
import { getGmailClient } from '../transports/gmailTransport.js';
import * as attachmentStore from '../../attachments/attachmentStore.js';
import { validateFile } from '../../attachments/attachmentPolicy.js';

/** The address enquiries must be addressed to — the Front Officer's own. */
export function enquiryRecipient() {
  return (identityForRole(IDENTITY_ROLES.FRONT_OFFICE)?.email || '').toLowerCase();
}

/**
 * What we ask Gmail for.
 *
 * Constrained to the Front Officer's own address, and to that alone. There is
 * deliberately no sender filter: an enquiry can arrive from anyone, so the
 * inbox is an N:1 intake — many external inquirers, one Front Office mailbox.
 *
 * This used to also carry `from:(<the one configured inquirer>)`, on the
 * reasoning that an unqualified search over a real personal inbox would turn a
 * friend's message or a receipt into a Query Case. That reasoning was sound
 * while arriving mail registered itself. It no longer applies: nothing here
 * creates a case. A message only *appears* for the Front Officer to accept or
 * reject, and a human decides. Filtering by sender would instead mean an
 * enquiry from an unknown member of the public was silently discarded before
 * anyone saw it — the worse of the two failures.
 */
export function inboxQuery({ unreadOnly = true } = {}) {
  const recipient = enquiryRecipient();

  return ['in:inbox', unreadOnly ? 'is:unread' : null, recipient ? `to:(${recipient})` : null]
    .filter(Boolean)
    .join(' ');
}

/** Pull the bare address out of `Name <addr>` or a bare address. */
function bareAddress(header) {
  const raw = String(header || '');
  return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
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
 * The gate every fetched message passes before it is shown to the Front Officer.
 * Applied to what Gmail actually returned, not only to what we asked for.
 *
 * Recipient only. Who sent it is not a filter — see `inboxQuery`.
 */
export function isEligibleEnquiry(message) {
  return isEnquiryRecipient(message?.to);
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
 * Did the sender deliberately attach this part as a file?
 *
 * A filename alone does not mean "attachment", which is what this used to
 * test. Gmail names inline parts too: an email signature logo arrives as
 * `image001.png` with a real `attachmentId`, and image/png is an allowed type
 * — so every signature became a document on the case, was written to disk,
 * and was forwarded to the Officer-in-Charge as though the inquirer had sent
 * it.
 *
 * RFC 2183 is the authority. `Content-Disposition: attachment` is the sender
 * saying "this is a separate file"; `inline` says "render me inside the body";
 * and a `Content-ID` means the HTML body references this part, so it is
 * decoration rather than a document.
 */
function isRealAttachment(part) {
  if (!part?.filename) return false;

  const disposition = header(part, 'Content-Disposition').trim().toLowerCase();
  const hasContentId = Boolean(header(part, 'Content-ID'));

  if (disposition.startsWith('attachment')) return true;
  if (disposition.startsWith('inline')) return false;

  // No Content-Disposition at all. Fall back to "named, fetchable, and not
  // referenced by the body" rather than defaulting to true — a part nothing
  // can reference, which Gmail will hand us bytes for, is almost certainly a
  // genuine attachment from a client that omitted the header.
  return !hasContentId && Boolean(part.body?.attachmentId);
}

/**
 * Attachment METADATA only — name, type, size. The file bytes are never
 * downloaded or stored here; `attachmentId` is the handle Gmail would need to
 * fetch one later.
 */
function extractAttachments(payload, found = []) {
  for (const part of payload?.parts || []) {
    if (isRealAttachment(part)) {
      found.push({
        id: part.body?.attachmentId || null,
        name: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        sizeKb: Math.max(1, Math.round((part.body?.size || 0) / 1024)),
        // The raw declared byte count, for the policy check. sizeKb is rounded
        // and floored at 1, so it cannot be used to enforce a limit.
        declaredSize: part.body?.size ?? null,
      });
      // Do not descend into a part that is itself an attachment. A forwarded
      // message attached as .eml is one attachment, not one plus every file
      // that happens to live inside it.
      continue;
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

      /**
       * Size is checked twice, and the second one is the one that counts.
       *
       * The declared size is the SENDER's claim, so it is used only to avoid
       * downloading a part that is already over the limit — a part that
       * declares nothing is not refused here, because the real length settles
       * it a few lines below. Before this, the only check passed `size: null`
       * and, since the policy skipped absent sizes, the sole ingest path a
       * fully external sender can drive had no size limit at all.
       */
      const declared = Number.isFinite(att.declaredSize) ? att.declaredSize : null;
      if (declared !== null) {
        const check = validateFile({ filename: att.name, mimeType: att.mimeType, size: declared });
        if (!check.ok) {
          return { ...att, attachmentId: null, materializeError: check.reason };
        }
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

        // Whatever was declared, this is the size that is actually true — and
        // it is also where the type check lands for a part that declared none.
        const actual = validateFile({
          filename: att.name,
          mimeType: att.mimeType,
          size: buffer.length,
        });
        if (!actual.ok) {
          return { ...att, attachmentId: null, materializeError: actual.reason };
        }

        const id = deterministicAttachmentId(`${messageId}:${att.id}`);
        const meta = await attachmentStore.saveWithId(id, {
          buffer,
          filename: att.name,
          mimeType: att.mimeType,
          providerMessageId: messageId,
          providerAttachmentId: att.id,
        });
        const { declaredSize, ...rest } = att;
        return { ...rest, attachmentId: meta.attachmentId, sizeKb: Math.max(1, Math.round(meta.size / 1024)) };
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
 * A parsed message, kept so the next poll need not fetch it again.
 *
 * A Gmail message's content never changes; only its labels do, and read/unread
 * is taken from a search below rather than from the message. Polling used to
 * cost one search plus one fetch per message plus a re-download of every
 * attachment — 26 requests and a re-fetch of the same bytes every 30 seconds,
 * which on a flaky DNS took 30-46 s and failed far more often than one request
 * would. A steady-state poll now costs two searches.
 *
 * Bounded, oldest evicted first, and process-local: losing it costs one refetch.
 */
const MESSAGE_CACHE_LIMIT = 500;
const messageCache = new Map();

function cachedMessage(id) {
  const hit = messageCache.get(id);
  if (!hit) return null;
  // Re-inserting makes the map least-recently-used ordered.
  messageCache.delete(id);
  messageCache.set(id, hit);
  return hit;
}

function rememberMessage(id, message) {
  messageCache.set(id, message);
  if (messageCache.size > MESSAGE_CACHE_LIMIT) {
    messageCache.delete(messageCache.keys().next().value);
  }
}

/** Forget what is cached — for tests, and for a mailbox switch. */
export function resetCache() {
  messageCache.clear();
  inFlight.clear();
}

/**
 * How many message fetches may be in the air at once.
 *
 * Unbounded `Promise.all` over 25 ids opens 25 sockets, each needing its own
 * DNS lookup, through libuv's four-thread resolver pool. That is how one slow
 * resolver turned a poll into 46 seconds.
 */
const FETCH_CONCURRENCY = 4;

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * One read at a time per query.
 *
 * Two pollers watch this mailbox — the background count and the inbox page —
 * and both land on the same searches. Sharing one in-flight read halves the
 * Gmail calls and stops two slow reads queueing behind each other.
 */
const inFlight = new Map();

/**
 * `client` is the test seam — the same injection pattern used for the dispatch
 * and forward senders. Production callers never pass it.
 */
async function list(recipient, { unreadOnly = false, max = 25, client = null } = {}) {
  const key = `${String(recipient || '').toLowerCase()}|${unreadOnly}|${max}`;
  const running = inFlight.get(key);
  if (running) return running;

  const work = readInbox(recipient, { unreadOnly, max, client }).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

async function readInbox(recipient, { unreadOnly, max, client }) {
  const gmail = client || getGmailClient(ROLE);
  const address = recipient || identityForRole(ROLE)?.email;

  /**
   * Two searches, not one fetch per message: which messages are in the inbox,
   * and which of them are unread. Read/unread is the only thing about a message
   * that changes, so it is the only thing worth asking for every time.
   */
  const [listed, unreadListed] = await Promise.all([
    gmail.users.messages.list({ userId: 'me', q: inboxQuery({ unreadOnly }), maxResults: max }),
    unreadOnly
      ? null
      : gmail.users.messages.list({ userId: 'me', q: inboxQuery({ unreadOnly: true }), maxResults: max }),
  ]);

  const ids = (listed.data.messages || []).map(({ id }) => id);
  const unread = new Set(
    unreadOnly ? ids : (unreadListed?.data.messages || []).map(({ id }) => id),
  );

  const messages = await mapWithLimit(ids, FETCH_CONCURRENCY, async (id) => {
    const hit = cachedMessage(id);
    if (hit) return hit;

    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const message = toMailboxMessage(full.data, address);

    // Bytes are downloaded once per message, and only for mail that may
    // actually open a case — after the eligibility gate, not before.
    const stored =
      isEligibleEnquiry(message) && message.attachments?.length
        ? {
            ...message,
            attachments: await materialiseAttachments(gmail, message.providerMessageId, message.attachments),
          }
        : message;

    rememberMessage(id, stored);
    return stored;
  });

  return (
    messages
      // Never hand back mail that was not addressed to the Front Officer,
      // whatever the search returned. The Gmail query is the first filter, this
      // is the binding one.
      .filter(isEligibleEnquiry)
      // Read/unread comes from the search, so a cached message is never stale
      // about the one thing that moves.
      .map((message) => ({ ...message, ingested: !unread.has(message.providerMessageId) }))
      // Oldest first, matching the other stores' insertion ordering.
      .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt))
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
