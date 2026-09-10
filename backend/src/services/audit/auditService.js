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

const matches = (event, { action, queryId, messageId }) =>
  (!action || event.action === action) &&
  (!queryId || event.queryId === queryId) &&
  (!messageId || event.messageId === messageId);

/**
 * Newest first, matching how an audit trail is read.
 *
 * Buffered events are always included, even when Mongo is connected. The
 * buffer then holds exactly the events whose write to Mongo *failed*, and
 * those are the ones an operator most needs to see — leaving them out would
 * make the fallback a write-only hole that silently swallows the records of
 * every action taken during an outage.
 */
async function list({ action = null, queryId = null, messageId = null, limit = 100 } = {}) {
  const criteria = { action, queryId, messageId };
  const buffered = buffer.filter((event) => matches(event, criteria));

  if (!isConnected()) return buffered.slice(-limit).reverse();

  const filter = {};
  if (action) filter.action = action;
  if (queryId) filter.queryId = queryId;
  if (messageId) filter.messageId = messageId;

  const persisted = await AuditEvent.find(filter).sort({ timestamp: -1 }).limit(limit).lean();

  return [...buffered, ...persisted]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
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

export { record, list, resetBuffer, describe };
