import { createHash } from 'crypto';
import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { isConnected } from '../../../config/db.js';
import browserConfig from '../../../config/browserConfig.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import * as audit from '../../audit/auditService.js';
import { readInbox } from '../nic/browser/readInbox.js';
import { pending as browserPending } from '../nic/browser/session.js';
import { normaliseAddress } from './address.js';
import { searchFilter } from './messageView.js';

/**
 * The NICeMail mailbox, read by the browser agent, as a QMS mailbox store.
 *
 * Same five-function interface as the other stores, so the Front Office inbox
 * and the accept flow treat it exactly like any other mailbox. The difference
 * is where messages come from: a sync reads the live inbox through the
 * signed-in browser and stores what it finds in MailboxMessage. Listing then
 * reads from MongoDB, never from the browser.
 *
 * Deduplication is structural. A message's id is derived from the provider's
 * own id, and it is written with `$setOnInsert` under a unique key — so
 * reading the same inbox a hundred times stores each message once, and never
 * resets a message the Front Office already ingested or removed.
 */

export const SOURCE = 'nic-browser';

const unavailable = () =>
  Object.assign(new Error('The NICeMail browser mailbox needs MongoDB, which is not connected.'), {
    status: 503,
  });

const mailboxMessageId = (providerMessageId) =>
  `NICB-${createHash('sha1').update(providerMessageId).digest('hex').slice(0, 16)}`;

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

// ── Sync ─────────────────────────────────────────────────────────────────────

let lastSyncAt = 0;
let inFlight = null;
let status = { ok: null, at: null, stored: 0, stage: null, error: null };

/** The reader drops a larger HTML body itself; the store does not trust that. */
const BODY_HTML_MAX = 1000000;
const RECEIVED_AT_SOURCES = new Set(['message', 'sync']);

async function store(address, message) {
  const id = mailboxMessageId(message.providerMessageId);
  const now = new Date().toISOString();
  try {
    const result = await MailboxMessage.updateOne(
      { mailboxMessageId: id },
      {
        $setOnInsert: {
          mailboxMessageId: id,
          providerMessageId: message.providerMessageId,
          providerThreadId: message.providerThreadId || null,
          source: SOURCE,
          // The mailbox it arrived in, not the To header: Bcc'd and list mail
          // still belongs to this mailbox's Front Office. The header is kept
          // beside it.
          to: address,
          toAddresses: Array.isArray(message.to) ? message.to : [],
          from: message.from,
          cc: message.cc || [],
          bcc: message.bcc || [],
          subject: message.subject || '(no subject)',
          body: message.body || '',
          bodyHtml:
            typeof message.bodyHtml === 'string' && message.bodyHtml.length <= BODY_HTML_MAX ? message.bodyHtml : null,
          attachments: message.attachments || [],
          receivedAt: message.receivedAt || now,
          receivedAtSource: message.receivedAt
            ? RECEIVED_AT_SOURCES.has(message.receivedAtSource)
              ? message.receivedAtSource
              : null
            : 'sync',
          providerUnread: typeof message.unread === 'boolean' ? message.unread : null,
          readAt: null,
          readByUserId: null,
          ingested: false,
          removedAt: null,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    return result?.upsertedCount ? 1 : 0;
  } catch (error) {
    // Two syncs racing on the same message: the other one stored it.
    if (error?.code === 11000) return 0;
    throw error;
  }
}

/** A message that failed to read this many times in this process is left alone. */
const QUARANTINE_AFTER = 3;
/** providerMessageId → failed reads, in this process. A restart forgets it. */
const attempts = new Map();
/** When the current run of failed syncs began. */
let failingSince = null;

const quarantinedIds = () => [...attempts].filter(([, count]) => count >= QUARANTINE_AFTER).map(([id]) => id);
/** Failed before, not yet given up on: the reader tries these again, after the rest. */
const retryIds = () => [...attempts].filter(([, count]) => count < QUARANTINE_AFTER).map(([id]) => id);

/**
 * The sync's audit rows: its edges — failing, recovered — and a completed sync
 * only when it did something. The inbox is polled every 30 seconds; a row for
 * every quiet poll would bury the ones that matter.
 */
async function recordSync(action, { failed = false, error = null, details }) {
  await audit.record({
    action,
    actorType: ACTOR_TYPES.SYSTEM,
    result: failed ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
    ...(error ? { error } : {}),
    details: { source: SOURCE, ...details },
  });
}

/**
 * Read the live inbox once and store anything new — the Mail Ingestion
 * Service. The browser agent reads; this stores, deduplicates and audits;
 * turning a message into a case stays with the Front Office (acceptMessage).
 *
 * Each message is stored as it is read. A message that cannot be read is
 * counted and tried again next time, up to QUARANTINE_AFTER times; a failure
 * to store is not a message's fault, so it stops the read.
 *
 * Never throws: the outcome is kept in `syncStatus()`, because a closed Chrome
 * or an expired sign-in must not break the inbox view of what is already
 * stored. `reader` is the test seam; `trigger` is 'poll' or 'manual'.
 */
async function sync(address = browserConfig.mailboxAddress, { reader = readInbox, trigger = 'poll' } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const wanted = normaliseAddress(address);
    const started = Date.now();
    const previous = status.ok;
    const seen = new Set();
    const storedIds = [];

    try {
      const known = await MailboxMessage.find({ source: SOURCE }).select('providerMessageId').lean();
      const skip = new Set([...known.map((doc) => doc.providerMessageId).filter(Boolean), ...quarantinedIds()]);

      const onMessage = async (message) => {
        const id = message?.providerMessageId;
        if (!id || skip.has(id) || seen.has(id)) return;
        seen.add(id);
        if (await store(wanted, message)) storedIds.push(id);
        attempts.delete(id);
      };

      const out = await reader({ max: browserConfig.syncMax, skip, retry: new Set(retryIds()), onMessage });
      // A reader that returns its messages instead of streaming them; the
      // `seen` set keeps one that does both from storing anything twice.
      for (const message of Array.isArray(out) ? out : out?.messages ?? []) await onMessage(message);

      // Counted only from a read that completed: a read that threw may be the
      // page's fault, and must not quarantine good mail.
      const failures = out?.failures ?? [];
      for (const { providerMessageId } of failures) {
        attempts.set(providerMessageId, (attempts.get(providerMessageId) || 0) + 1);
      }

      status = {
        ok: true,
        at: new Date().toISOString(),
        stored: storedIds.length,
        stage: null,
        error: null,
        failed: failures.length,
        failedMessages: failures.slice(0, 5),
        quarantined: quarantinedIds().length,
        remaining: out?.remaining ?? 0,
      };

      if (previous === false) await recordSync(AUDIT_ACTIONS.SYNC_RECOVERED, { details: { address: wanted, since: failingSince } });
      failingSince = null;
      if (storedIds.length || failures.length || trigger === 'manual') {
        await recordSync(AUDIT_ACTIONS.SYNC_COMPLETED, {
          details: {
            address: wanted,
            trigger,
            stored: storedIds.length,
            providerMessageIds: storedIds,
            failed: failures.length,
            quarantined: status.quarantined,
            remaining: status.remaining,
            durationMs: Date.now() - started,
          },
        });
      }
    } catch (error) {
      status = {
        ok: false,
        at: new Date().toISOString(),
        // What was stored before the read stopped is kept, and said so.
        stored: storedIds.length,
        stage: error?.stage || null,
        error: String(error?.message || error).split('\n')[0],
        failed: 0,
        failedMessages: [],
        quarantined: quarantinedIds().length,
        remaining: 0,
      };

      if (previous !== false) failingSince = status.at;
      if (previous !== false || trigger === 'manual') {
        await recordSync(AUDIT_ACTIONS.SYNC_FAILED, {
          failed: true,
          error: status.error,
          details: { address: wanted, trigger, stage: status.stage, stored: storedIds.length },
        });
      }
    } finally {
      lastSyncAt = Date.now();
      inFlight = null;
    }
    return status;
  })();

  return inFlight;
}

/**
 * Start a sync in the background when the last one is older than the TTL.
 *
 * Unless somebody is waiting on the browser. A sync and a send share one
 * serialised session, and the Front Office inbox poll runs on every
 * authenticated page at the same 30 s cadence as the TTL — so a sync is due on
 * very nearly every tick, and a send arriving at the wrong moment queues behind
 * a run that opens up to `syncMax` messages. A sync is a background convenience
 * that will happen on the next poll regardless; a send is a person waiting for
 * an email to leave. The send wins.
 */
function syncIfDue(address) {
  if (inFlight || Date.now() - lastSyncAt < browserConfig.syncTtlMs) return;
  if (browserPending() > 0) return;
  sync(address);
}

const syncStatus = () => ({ ...status, running: Boolean(inFlight) });

/** Test-only. */
function resetSyncState() {
  lastSyncAt = 0;
  inFlight = null;
  status = { ok: null, at: null, stored: 0, stage: null, error: null };
  attempts.clear();
  failingSince = null;
}

// ── Mailbox interface ────────────────────────────────────────────────────────

const scope = (recipient) => ({ to: normaliseAddress(recipient), source: SOURCE, removedAt: null });

function listFilter(recipient, { unreadOnly = false, q } = {}) {
  const filter = { ...scope(recipient), ...searchFilter(q) };
  if (unreadOnly) filter.ingested = false;
  return filter;
}

/**
 * Stored messages, newest first — a page of them when `limit` is given, all of
 * them otherwise. Kicks off a background sync when one is due, so the Front
 * Office inbox poll is what drives reading — a message appears on the poll
 * after the sync that found it. The HTML body is left out: a list is polled
 * every few seconds, and only a message's own page shows it.
 */
async function list(recipient, { unreadOnly = false, q, limit, offset = 0 } = {}) {
  if (!isConnected()) throw unavailable();
  syncIfDue(recipient);

  let query = MailboxMessage.find(listFilter(recipient, { unreadOnly, q }))
    .select('-bodyHtml')
    .sort({ receivedAt: -1, mailboxMessageId: -1 });
  if (limit) query = query.skip(offset).limit(limit);
  const docs = await query.lean();
  return docs.map(toPlain);
}

/** How many messages `list` would return without a limit. */
async function count(recipient, options = {}) {
  if (!isConnected()) throw unavailable();
  return MailboxMessage.countDocuments(listFilter(recipient, options));
}

async function get(recipient, id) {
  if (!isConnected()) throw unavailable();
  return toPlain(await MailboxMessage.findOne({ ...scope(recipient), mailboxMessageId: id }).lean());
}

/**
 * The Front Office has opened it in the dashboard. QMS state only: NICeMail's
 * own read state is the operator's, and the agent puts it back after every
 * read, so nothing here goes near the browser. The first read is the one kept.
 * Resolves `{ message, changed }`, or null for a message not in this mailbox.
 */
async function markRead(recipient, id, reader = {}) {
  if (!isConnected()) throw unavailable();
  const changed = await MailboxMessage.findOneAndUpdate(
    { ...scope(recipient), mailboxMessageId: id, readAt: null },
    { $set: { readAt: new Date().toISOString(), readByUserId: reader.id ?? null } },
    { returnDocument: 'after' },
  ).lean();
  if (changed) return { message: toPlain(changed), changed: true };

  const message = await get(recipient, id);
  return message ? { message, changed: false } : null;
}

/** A sync asked for by hand is refused this soon after the last one ended. */
const MANUAL_SYNC_GAP_MS = 15000;

/**
 * A sync someone asked for, started in the background. It joins one already
 * running, and a click moments after one ended starts nothing: each sync opens
 * a browser tab and up to NIC_BROWSER_SYNC_MAX messages.
 */
function requestSync(address = browserConfig.mailboxAddress) {
  if (!isConnected()) throw unavailable();
  const started = !inFlight && Date.now() - lastSyncAt >= MANUAL_SYNC_GAP_MS;
  if (started) sync(address, { trigger: 'manual' });
  return { started, sync: syncStatus() };
}

async function markIngested(recipient, id) {
  if (!isConnected()) throw unavailable();
  const doc = await MailboxMessage.findOneAndUpdate(
    { ...scope(recipient), mailboxMessageId: id },
    { $set: { ingested: true } },
    { returnDocument: 'after' },
  ).lean();
  return toPlain(doc);
}

/** Hidden, not deleted: the record is what stops the next sync bringing it back. */
async function remove(recipient, id) {
  if (!isConnected()) throw unavailable();
  const doc = await MailboxMessage.findOneAndUpdate(
    { ...scope(recipient), mailboxMessageId: id },
    { $set: { removedAt: new Date().toISOString() } },
    { returnDocument: 'after' },
  ).lean();
  return toPlain(doc);
}

const readOnly = (operation) => {
  throw new Error(
    `The NICeMail browser mailbox is read-only — ${operation} is not available. ` +
      'Mail arrives in it by genuinely being sent.',
  );
};

const deliver = async () => readOnly('depositing a message');
const reset = async () => readOnly('clearing the mailbox');

async function stats() {
  if (!isConnected()) return { recipients: 0, messages: 0 };
  const messages = await MailboxMessage.countDocuments({ source: SOURCE, removedAt: null });
  return { recipients: messages ? 1 : 0, messages };
}

function describe() {
  return {
    backend: SOURCE,
    persistence:
      'the NICeMail mailbox, read through the signed-in browser session and stored in MongoDB',
    sync: syncStatus(),
  };
}

export const backend = SOURCE;
export {
  deliver,
  list,
  count,
  get,
  markRead,
  requestSync,
  markIngested,
  remove,
  reset,
  stats,
  describe,
  sync,
  syncStatus,
  resetSyncState,
};
