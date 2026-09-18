import { createHash } from 'crypto';
import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { isConnected } from '../../../config/db.js';
import browserConfig from '../../../config/browserConfig.js';
import { readInbox } from '../nic/browser/readInbox.js';
import { normaliseAddress } from './address.js';

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

async function store(address, message) {
  const id = mailboxMessageId(message.providerMessageId);
  try {
    const result = await MailboxMessage.updateOne(
      { mailboxMessageId: id },
      {
        $setOnInsert: {
          mailboxMessageId: id,
          providerMessageId: message.providerMessageId,
          source: SOURCE,
          // The mailbox it arrived in, not the To header: Bcc'd and list mail
          // still belongs to this mailbox's Front Office.
          to: address,
          from: message.from,
          cc: message.cc || [],
          bcc: [],
          subject: message.subject || '(no subject)',
          body: message.body || '',
          attachments: message.attachments || [],
          receivedAt: message.receivedAt || new Date().toISOString(),
          ingested: false,
          removedAt: null,
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

/**
 * Read the live inbox once and store anything new.
 *
 * Never throws: the outcome is kept in `syncStatus()`, because a closed Chrome
 * or an expired sign-in must not break the inbox view of what is already
 * stored. `reader` is the test seam.
 */
async function sync(address = browserConfig.mailboxAddress, { reader = readInbox } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const wanted = normaliseAddress(address);
    try {
      const known = await MailboxMessage.find({ source: SOURCE }).select('providerMessageId').lean();
      const skip = new Set(known.map((doc) => doc.providerMessageId).filter(Boolean));

      const messages = await reader({ max: browserConfig.syncMax, skip });
      let stored = 0;
      for (const message of messages) {
        if (message?.providerMessageId && !skip.has(message.providerMessageId)) {
          stored += await store(wanted, message);
        }
      }

      status = { ok: true, at: new Date().toISOString(), stored, stage: null, error: null };
    } catch (error) {
      status = {
        ok: false,
        at: new Date().toISOString(),
        stored: 0,
        stage: error?.stage || null,
        error: String(error?.message || error).split('\n')[0],
      };
    } finally {
      lastSyncAt = Date.now();
      inFlight = null;
    }
    return status;
  })();

  return inFlight;
}

/** Start a sync in the background when the last one is older than the TTL. */
function syncIfDue(address) {
  if (inFlight || Date.now() - lastSyncAt < browserConfig.syncTtlMs) return;
  sync(address);
}

const syncStatus = () => ({ ...status, running: Boolean(inFlight) });

/** Test-only. */
function resetSyncState() {
  lastSyncAt = 0;
  inFlight = null;
  status = { ok: null, at: null, stored: 0, stage: null, error: null };
}

// ── Mailbox interface ────────────────────────────────────────────────────────

const scope = (recipient) => ({ to: normaliseAddress(recipient), source: SOURCE, removedAt: null });

/**
 * Stored messages, newest first. Kicks off a background sync when one is due,
 * so the Front Office inbox poll is what drives reading — a message appears on
 * the poll after the sync that found it.
 */
async function list(recipient, { unreadOnly = false } = {}) {
  if (!isConnected()) throw unavailable();
  syncIfDue(recipient);

  const filter = scope(recipient);
  if (unreadOnly) filter.ingested = false;
  const docs = await MailboxMessage.find(filter).sort({ receivedAt: -1 }).lean();
  return docs.map(toPlain);
}

async function get(recipient, id) {
  if (!isConnected()) throw unavailable();
  return toPlain(await MailboxMessage.findOne({ ...scope(recipient), mailboxMessageId: id }).lean());
}

async function markIngested(recipient, id) {
  if (!isConnected()) throw unavailable();
  const doc = await MailboxMessage.findOneAndUpdate(
    { ...scope(recipient), mailboxMessageId: id },
    { $set: { ingested: true } },
    { new: true },
  ).lean();
  return toPlain(doc);
}

/** Hidden, not deleted: the record is what stops the next sync bringing it back. */
async function remove(recipient, id) {
  if (!isConnected()) throw unavailable();
  const doc = await MailboxMessage.findOneAndUpdate(
    { ...scope(recipient), mailboxMessageId: id },
    { $set: { removedAt: new Date().toISOString() } },
    { new: true },
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
  get,
  markIngested,
  remove,
  reset,
  stats,
  describe,
  sync,
  syncStatus,
  resetSyncState,
};
