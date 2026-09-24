import { isConnected, isDatabaseConfigured } from '../../config/db.js';
import { AuditEvent } from '../../models/AuditEvent.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_RESULTS } from '../../constants/auditActions.js';

const MAX_BUFFERED = 5000;
let buffer = [];

const persistent = () => isConnected() || isDatabaseConfigured();

function toRecord(input) {
  return {
    timestamp: input.timestamp || new Date().toISOString(),
    actorType: input.actorType || ACTOR_TYPES.SYSTEM,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    auditId: input.auditId ?? null,
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

async function record(input) {
  if (!input?.action) {
    console.error('[audit] refusing to record an event with no action');
    return null;
  }

  const event = toRecord(input);

  if (!persistent()) {
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

const matches = (event, { action, actorType, actorId, result, queryId, messageId, from, to }) =>
  (!action || event.action === action) &&
  (!actorType || event.actorType === actorType) &&
  (!actorId || event.actorId === actorId) &&
  (!result || event.result === result) &&
  (!queryId || event.queryId === queryId) &&
  (!messageId || event.messageId === messageId) &&
  (!from || String(event.timestamp) >= from) &&
  (!to || String(event.timestamp) <= to);

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

async function list(criteria = {}) {
  const { limit = 100, offset = 0 } = criteria;
  const buffered = buffer.filter((event) => matches(event, criteria));

  if (!persistent()) {
    return [...buffered].reverse().slice(offset, offset + limit);
  }

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

async function summary(criteria = {}) {
  const buffered = buffer.filter((event) => matches(event, criteria));
  const durability = describe();

  if (!persistent()) {
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

function resetBuffer() {
  buffer = [];
}

function describe() {
  return persistent()
    ? { backend: 'mongo', durable: true }
    : { backend: 'in-memory', durable: false };
}

export { record, list, summary, resetBuffer, describe };
