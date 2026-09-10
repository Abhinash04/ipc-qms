import { isConnected } from '../../config/db.js';
import { AuditEvent } from '../../models/AuditEvent.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_RESULTS } from '../../constants/auditActions.js';

/**
 * The audit trail.
 *
 * Persists to Mongo when it is connected and to an in-process buffer when it
 * is not, matching how `services/email/mailbox/index.js` already degrades. The
 * buffer is a development and test convenience only — it is explicitly not a
 * durable audit trail, which is what `describe()` reports so an operator can
 * tell the difference.
 */

/**
 * Bounded so a long-running dev server cannot leak memory. Oldest entries are
 * dropped first; a production deployment has Mongo and never reaches this.
 */
const MAX_BUFFERED = 5000;
let buffer = [];

function toRecord(input) {
  return {
    timestamp: input.timestamp || new Date().toISOString(),
    actorType: input.actorType || ACTOR_TYPES.SYSTEM,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    result: input.result || AUDIT_RESULTS.SUCCESS,
    queryId: input.queryId ?? null,
    messageId: input.messageId ?? null,
    threadId: input.threadId ?? null,
    attachmentId: input.attachmentId ?? null,
    error: input.error ?? null,
    aiMetadata: input.aiMetadata ?? null,
    details: input.details ?? null,
  };
}

/**
 * Record one event.
 *
 * **Never throws.** A failed audit write must not roll back an action that
 * already happened — an email that was genuinely sent is still sent whether
 * or not Mongo accepted the record. The failure is reported on stderr and the
 * event is kept in the buffer so it is not lost outright, and the returned
 * record carries `persisted: false` for callers that want to react.
 */
async function record(input) {
  if (!input?.action) {
    console.error('[audit] refusing to record an event with no action');
    return null;
  }

  const event = toRecord(input);

  if (!isConnected()) {
    push(event);
    return { ...event, persisted: false };
  }

  try {
    await AuditEvent.create(event);
    return { ...event, persisted: true };
  } catch (error) {
    console.error(`[audit] failed to persist ${event.action}: ${error.message}`);
    push(event);
    return { ...event, persisted: false };
  }
}

function push(event) {
  buffer.push(event);
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
}

/**
 * `timestamp` is an ISO-8601 string, and ISO-8601 sorts and compares correctly
 * as text — so the same `from`/`to` bounds work against the buffer and against
 * Mongo without converting either side to Date.
 */
const matches = (event, { action, actorType, actorId, result, queryId, messageId, from, to }) =>
  (!action || event.action === action) &&
  (!actorType || event.actorType === actorType) &&
  (!actorId || event.actorId === actorId) &&
  (!result || event.result === result) &&
  (!queryId || event.queryId === queryId) &&
  (!messageId || event.messageId === messageId) &&
  (!from || String(event.timestamp) >= from) &&
  (!to || String(event.timestamp) <= to);

/** The same criteria as a Mongo filter document. */
function toMongoFilter({ action, actorType, actorId, result, queryId, messageId, from, to }) {
  const filter = {};
  if (action) filter.action = action;
  if (actorType) filter.actorType = actorType;
  if (actorId) filter.actorId = actorId;
  if (result) filter.result = result;
  if (queryId) filter.queryId = queryId;
  if (messageId) filter.messageId = messageId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  return filter;
}

/**
 * Newest first, matching how an audit trail is read.
 *
 * Buffered events are always included, even when Mongo is connected. The
 * buffer then holds exactly the events whose write to Mongo *failed*, and
 * those are the ones an operator most needs to see — leaving them out would
 * make the fallback a write-only hole that silently swallows the records of
 * every action taken during an outage.
 */
async function list(criteria = {}) {
  const { limit = 100, offset = 0 } = criteria;
  const buffered = buffer.filter((event) => matches(event, criteria));

  if (!isConnected()) {
    return [...buffered].reverse().slice(offset, offset + limit);
  }

  // `offset + limit` from Mongo, because the buffer is merged in afterwards and
  // could contribute entries that belong on this page.
  const persisted = await AuditEvent.find(toMongoFilter(criteria))
    .sort({ timestamp: -1 })
    .limit(offset + limit)
    .lean();

  return [...buffered, ...persisted]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(offset, offset + limit);
}

const tally = (events, field) =>
  events.reduce((acc, event) => {
    const key = event[field] || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const mergeCounts = (a, b) => {
  const merged = { ...a };
  for (const [key, count] of Object.entries(b)) merged[key] = (merged[key] || 0) + count;
  return merged;
};

/**
 * Aggregates that back the Administration KPI cards.
 *
 * Counted, not sampled — the numbers come from `countDocuments`/`aggregate`
 * rather than from a truncated page of `list()`, so they stay true once the
 * collection outgrows any one page.
 */
async function summary(criteria = {}) {
  const buffered = buffer.filter((event) => matches(event, criteria));
  const durability = describe();

  if (!isConnected()) {
    return {
      total: buffered.length,
      byAction: tally(buffered, 'action'),
      byResult: tally(buffered, 'result'),
      byActorType: tally(buffered, 'actorType'),
      ...durability,
    };
  }

  const filter = toMongoFilter(criteria);
  const group = async (field) => {
    const rows = await AuditEvent.aggregate([{ $match: filter }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
    return rows.reduce((acc, row) => ({ ...acc, [row._id || 'unknown']: row.n }), {});
  };

  const [total, byAction, byResult, byActorType] = await Promise.all([
    AuditEvent.countDocuments(filter),
    group('action'),
    group('result'),
    group('actorType'),
  ]);

  return {
    total: total + buffered.length,
    byAction: mergeCounts(byAction, tally(buffered, 'action')),
    byResult: mergeCounts(byResult, tally(buffered, 'result')),
    byActorType: mergeCounts(byActorType, tally(buffered, 'actorType')),
    ...durability,
  };
}

/** Test-only. Clears the buffer; never touches persisted events. */
function resetBuffer() {
  buffer = [];
}

function describe() {
  return isConnected()
    ? { backend: 'mongo', durable: true }
    : { backend: 'in-memory', durable: false };
}

export { record, list, summary, resetBuffer, describe };
