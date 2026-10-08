import os from 'node:os';
import { isConnected, isDatabaseConfigured } from '../../config/db.js';
import { AuditEvent } from '../../models/AuditEvent.js';
import { User } from '../../models/User.js';
import { Counter } from '../../models/MailboxMessage.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../constants/auditActions.js';
import { GENESIS_HASH, computeHash, verifyRows } from './auditChain.js';
import { currentContext } from './requestContext.js';
import { resolveHostname } from './hostLookup.js';
import { currentPublicIp, isPrivateIp } from './publicIp.js';
import { inferCaseChanges, changeKeyOf } from './caseChanges.js';
import { refreshStaffDirectory } from './auditNarrative.js';
import { USERS, nicFrontOfficeUser } from '../../constants/users.js';

const MAX_BUFFERED = 5000;
const MAX_APPEND_ATTEMPTS = 8;
const VERIFY_BATCH = 1000;

let buffer = [];

const persistent = () => isConnected() || isDatabaseConfigured();

// Plain JSON only: what is hashed must be exactly what MongoDB stores and
// returns, so undefined, Dates and other non-JSON values are normalised first.
const plain = (value) => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)));

/**
 * Fills in `actorName` for display on events that stored only a user ID (events recorded
 * before names were captured, or by users outside the built-in list), from the built-in list
 * and the users collection. The stored events are not changed.
 */
/**
 * Fills in the device name for display on events recorded before it was captured, by looking
 * up each distinct IP address once. The stored events are not changed.
 */
async function withDeviceNames(rows) {
  const unnamed = (row) => row.source?.ip && !row.source.hostname && !row.source.server;
  const ips = [...new Set(rows.filter(unnamed).map((row) => lookupIpOf(row.source)))];
  if (!ips.length) return rows;
  const names = new Map();
  for (let i = 0; i < ips.length; i += 20) {
    const batch = ips.slice(i, i + 20);
    const found = await Promise.all(batch.map((ip) => resolveHostname(ip)));
    batch.forEach((ip, index) => found[index] && names.set(ip, found[index]));
  }
  return rows.map((row) =>
    unnamed(row) && names.has(lookupIpOf(row.source))
      ? { ...row, source: { ...row.source, hostname: names.get(lookupIpOf(row.source)) } }
      : row,
  );
}

const HISTORY_FIELDS = 'seq timestamp action queryId auditId changes details aiMetadata';
const HISTORY_CHUNK = 500;

/**
 * Fills in previous and new values for display on events recorded without them, worked out
 * from the whole recorded history of the queries concerned (see caseChanges.inferCaseChanges).
 * The stored events are not changed.
 */
async function withInferredChanges(rows) {
  const wanted = new Set(rows.filter((row) => !row.changes && row.queryId).map((row) => row.queryId));
  const ids = [...wanted];
  if (!ids.length) return rows;

  let history = buffer.filter((event) => wanted.has(event.queryId));
  if (persistent()) {
    try {
      const chunks = [];
      for (let i = 0; i < ids.length; i += HISTORY_CHUNK) chunks.push(ids.slice(i, i + HISTORY_CHUNK));
      const found = await Promise.all(
        chunks.map((chunk) => AuditEvent.find({ queryId: { $in: chunk } }, HISTORY_FIELDS).lean()),
      );
      history = history.concat(...found);
    } catch (error) {
      console.warn(`[audit] could not load query history: ${error.message}`);
      return rows;
    }
  }

  const inferred = inferCaseChanges(history);
  return rows.map((row) => {
    if (row.changes) return row;
    const changes = inferred.get(changeKeyOf(row));
    return changes ? { ...row, changes, changesInferred: true } : row;
  });
}

/** Names, device names and previous/new values filled in for display. */
const withDisplayDetails = async (rows) => {
  // Staff stored in the database, so every name in the wording carries a role.
  await refreshStaffDirectory();
  return withInferredChanges(await withDeviceNames(await withActorNames(rows)));
};

async function withActorNames(rows) {
  const missing = [...new Set(rows.filter((row) => !row.actorName && row.actorId).map((row) => row.actorId))];
  if (!missing.length) return rows;

  const names = new Map(missing.map((id) => [id, knownName(id)]).filter(([, name]) => name));
  const unresolved = missing.filter((id) => !names.has(id));
  if (unresolved.length && isConnected()) {
    try {
      const users = await User.find({ userId: { $in: unresolved } }, { userId: 1, name: 1 }).lean();
      for (const user of users) if (user.name) names.set(user.userId, user.name);
    } catch (error) {
      console.warn(`[audit] could not look up user names: ${error.message}`);
    }
  }
  return rows.map((row) => (!row.actorName && names.has(row.actorId) ? { ...row, actorName: names.get(row.actorId) } : row));
}

function knownName(actorId) {
  if (!actorId) return null;
  const nic = nicFrontOfficeUser();
  return USERS.find((user) => user.id === actorId)?.name || (nic?.id === actorId ? nic.name : null);
}

// This server's own identity, for events no request caused (scheduled sync, purges).
let serverIdentity = null;
function thisServer() {
  if (!serverIdentity) {
    const ipv4 = Object.values(os.networkInterfaces())
      .flat()
      .find((address) => address && address.family === 'IPv4' && !address.internal);
    serverIdentity = { server: os.hostname(), ip: ipv4?.address || '127.0.0.1' };
  }
  return serverIdentity;
}

const isLoopback = (ip) => ip === '::1' || /^127\./.test(String(ip || ''));

function requestAddress(context) {
  const loopback = isLoopback(context.ip);
  return {
    ...addressOf(loopback ? thisServer().ip : context.ip),
    ...(loopback ? { hostname: thisServer().server } : {}),
  };
}

/**
 * A private (office network) address as the audit trail records it: the network's public IPv4,
 * as the internet sees it, with the private address kept as `localIp`. Before the public
 * address is known, or for an address that is already public, the address as it is.
 */
function addressOf(ip) {
  const publicIp = isPrivateIp(ip) ? currentPublicIp() : null;
  return publicIp ? { ip: publicIp, localIp: ip } : { ip };
}

// The device name comes from the computer's own (local) address, never the shared public one.
const lookupIpOf = (source) => source?.localIp || source?.ip;

/**
 * The person and the machine behind an event. Anything recorded while handling a request
 * carries that request's IP address, browser, method and path — a person's own action, or AI
 * work their request started. Work no request caused (background jobs) carries this server's
 * hostname and IP instead.
 */
function attribution(input) {
  const context = currentContext();
  const own = context?.user && input.actorId && context.user.id === input.actorId;
  const actorName = input.actorName ?? (own ? context.user.name : null) ?? knownName(input.actorId);
  const source =
    input.source ??
    (context
      ? {
          ...requestAddress(context),
          userAgent: context.userAgent,
          method: context.method,
          path: context.path,
          host: thisServer().server,
          ...(context.user?.sessionId ? { sessionId: context.user.sessionId } : {}),
        }
      : { server: thisServer().server, ...addressOf(thisServer().ip) });
  return {
    ...(actorName ? { actorName } : {}),
    ...(source ? { source: plain(source) } : {}),
  };
}

function toRecord(input) {
  return {
    ...attribution(input),
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
    aiMetadata: plain(input.aiMetadata),
    details: plain(input.details),
    ...(input.changes && Object.keys(input.changes).length ? { changes: plain(input.changes) } : {}),
  };
}

// Appends run one at a time within this process, so the chain order is the
// order record() was called in. Other processes on the same database are
// serialised by the unique seq index instead (see appendChained).
let appendTail = Promise.resolve();

function serialised(task) {
  const run = appendTail.then(task, task);
  appendTail = run.catch(() => {});
  return run;
}

const CHAINED = { seq: { $type: 'number' } };

async function chainHead() {
  const [head] = await AuditEvent.find(CHAINED, { seq: 1, hash: 1 }).sort({ seq: -1 }).limit(1).lean();
  return head || null;
}

const isSeqCollision = (error) =>
  error?.code === 11000 && (error?.keyPattern?.seq !== undefined || /seq/.test(String(error?.message)));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Optimistic append: read the head, write seq+1, and if another writer won
 * that seq (duplicate key) read the new head and try again. A seq is only
 * ever taken by a successful insert, so the chain has no gaps and no forks.
 */
async function appendChained(event) {
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const head = await chainHead();
    const row = { ...event, seq: (head?.seq ?? 0) + 1, prevHash: head?.hash ?? GENESIS_HASH };
    row.hash = computeHash(row);

    try {
      await AuditEvent.create(row);
      return row;
    } catch (error) {
      if (!isSeqCollision(error)) throw error;
      await pause(5 + Math.floor(Math.random() * 20) * (attempt + 1));
    }
  }
  throw new Error(`could not claim a chain position after ${MAX_APPEND_ATTEMPTS} attempts`);
}

async function record(input) {
  if (!input?.action) {
    console.error('[audit] refusing to record an event with no action');
    return null;
  }

  const event = toRecord(input);
  // The requesting computer's network name, where DNS knows it (before hashing, so it is sealed).
  if (event.source?.ip && !event.source.hostname && !event.source.server) {
    const hostname = await resolveHostname(lookupIpOf(event.source));
    if (hostname) event.source = { ...event.source, hostname };
  }

  if (!persistent()) {
    push(event);
    return { ...event, seq: null, persisted: false };
  }

  return serialised(async () => {
    try {
      const row = await appendChained(event);
      return { ...row, persisted: true };
    } catch (error) {
      // Never throw from auditing. The event is kept in memory and reported
      // as unpersisted/unverified; it does not advance the chain.
      console.error(`[audit] failed to persist ${event.action}: ${error.message}`);
      push(event);
      return { ...event, seq: null, persisted: false };
    }
  });
}

function push(event) {
  buffer.push(event);
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
}

// A bare date as "to" means the whole of that day (UTC); timestamps compare as ISO strings, so
// "2026-09-30" alone would end the range at midnight and leave the day itself out.
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const endOfDay = (to) => (to && BARE_DATE.test(to) ? `${to}T23:59:59.999Z` : to);

const matches = (event, { action, actorType, actorId, result, queryId, messageId, from, to: rawTo }) => {
  const to = endOfDay(rawTo);
  return (
    (!action || event.action === action) &&
    (!actorType || event.actorType === actorType) &&
    (!actorId || event.actorId === actorId) &&
    (!result || event.result === result) &&
    (!queryId || event.queryId === queryId) &&
    (!messageId || event.messageId === messageId) &&
    (!from || String(event.timestamp) >= from) &&
    (!to || String(event.timestamp) <= to)
  );
};

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
    if (to) filter.timestamp.$lte = endOfDay(to);
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

/**
 * Every event matching the filters, oldest first, for a report. Persisted
 * rows come from the database; events still only in memory are included and
 * marked, so a report never silently omits them.
 */
async function exportRows(criteria = {}, { max = 50000 } = {}) {
  const buffered = buffer
    .filter((event) => matches(event, criteria))
    .map((event) => ({ ...event, seq: null, unpersisted: true }));

  let persisted = [];
  if (persistent()) {
    persisted = await AuditEvent.find(toMongoFilter(criteria))
      .sort({ timestamp: 1, seq: 1 })
      .limit(max + 1)
      .lean();
  }

  const rows = [...persisted, ...buffered].sort(
    (a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || (a.seq ?? Infinity) - (b.seq ?? Infinity),
  );

  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

/**
 * Re-computes the whole chain from the database and reports where it breaks.
 * Rows written before chaining existed are counted as legacy, not checked.
 */
async function verifyChain() {
  const report = {
    ok: true,
    checked: 0,
    legacy: 0,
    unpersisted: buffer.length,
    head: null,
    firstBreak: null,
    breaks: [],
    verifiedAt: new Date().toISOString(),
    ...describe(),
  };

  if (!persistent()) return report;

  let state;
  let lastSeq = 0;
  for (;;) {
    const batch = await AuditEvent.find({ seq: { $type: 'number', $gt: lastSeq } })
      .sort({ seq: 1 })
      .limit(VERIFY_BATCH)
      .lean();
    if (!batch.length) break;
    state = verifyRows(batch, state);
    lastSeq = batch[batch.length - 1].seq;
    report.head = { seq: lastSeq, hash: batch[batch.length - 1].hash };
    if (batch.length < VERIFY_BATCH) break;
  }

  report.checked = state?.checked ?? 0;
  report.legacy = await AuditEvent.countDocuments({ seq: { $exists: false } });
  report.breaks = (state?.breaks ?? []).slice(0, 50);
  report.firstBreak = report.breaks[0] ?? null;
  report.ok = report.breaks.length === 0;
  return report;
}

/**
 * The one sanctioned wipe: a local-only workflow reset. Clears the whole
 * audit collection through the raw driver (bypassing the append-only model
 * hooks), then starts a new chain whose first event names the reset, so
 * verification stays green and the restart is on the record.
 */
async function resetChain({ actor = {}, reason = 'workflow state reset' } = {}) {
  buffer = [];
  if (persistent()) {
    await serialised(() => AuditEvent.collection.deleteMany({}));
  }
  return record({
    action: AUDIT_ACTIONS.AUDIT_CHAIN_RESET,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: actor.id ?? null,
    actorRole: actor.role ?? null,
    details: { reason },
  });
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
    return Object.fromEntries(rows.map((row) => [row._id || 'unknown', row.n]));
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

const memoryReportCounters = new Map();

/**
 * The next audit report reference for the month the report is generated in (IST):
 * "BRIDGETECH/ATR/2026-10/001". Counted in the database, or in memory without one.
 */
async function nextReportReference(at = new Date().toISOString()) {
  const month = new Date(new Date(at).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const key = `auditReport.${month}`;
  let value;
  if (isConnected()) {
    const counter = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
    value = counter.value;
  } else {
    value = (memoryReportCounters.get(key) || 0) + 1;
    memoryReportCounters.set(key, value);
  }
  return `BRIDGETECH/ATR/${month}/${String(value).padStart(3, '0')}`;
}

export {
  nextReportReference,
  record,
  list,
  summary,
  exportRows,
  withActorNames,
  withDeviceNames,
  withInferredChanges,
  withDisplayDetails,
  verifyChain,
  resetChain,
  resetBuffer,
  describe,
  toMongoFilter,
};
