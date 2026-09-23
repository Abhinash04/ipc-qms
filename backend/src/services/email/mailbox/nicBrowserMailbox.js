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

let lastSyncAt = 0;
let inFlight = null;
let status = { ok: null, at: null, stored: 0, stage: null, error: null };

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
    if (error?.code === 11000) return 0;
    throw error;
  }
}

const QUARANTINE_AFTER = 3;
const attempts = new Map();
let failingSince = null;

const quarantinedIds = () => [...attempts].filter(([, count]) => count >= QUARANTINE_AFTER).map(([id]) => id);
const retryIds = () => [...attempts].filter(([, count]) => count < QUARANTINE_AFTER).map(([id]) => id);

async function recordSync(action, { failed = false, error = null, details }) {
  await audit.record({
    action,
    actorType: ACTOR_TYPES.SYSTEM,
    result: failed ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
    ...(error ? { error } : {}),
    details: { source: SOURCE, ...details },
  });
}

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
      for (const message of Array.isArray(out) ? out : out?.messages ?? []) await onMessage(message);

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

function syncIfDue(address) {
  if (inFlight || Date.now() - lastSyncAt < browserConfig.syncTtlMs) return;
  if (browserPending() > 0) return;
  sync(address);
}

const syncStatus = () => ({ ...status, running: Boolean(inFlight) });

function resetSyncState() {
  lastSyncAt = 0;
  inFlight = null;
  status = { ok: null, at: null, stored: 0, stage: null, error: null };
  attempts.clear();
  failingSince = null;
}

const scope = (recipient) => ({ to: normaliseAddress(recipient), source: SOURCE, removedAt: null });

function listFilter(recipient, { unreadOnly = false, q } = {}) {
  const filter = { ...scope(recipient), ...searchFilter(q) };
  if (unreadOnly) filter.ingested = false;
  return filter;
}

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

async function count(recipient, options = {}) {
  if (!isConnected()) throw unavailable();
  return MailboxMessage.countDocuments(listFilter(recipient, options));
}

async function get(recipient, id) {
  if (!isConnected()) throw unavailable();
  return toPlain(await MailboxMessage.findOne({ ...scope(recipient), mailboxMessageId: id }).lean());
}

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

const MANUAL_SYNC_GAP_MS = 15000;

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
