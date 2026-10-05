import env from '../../config/env.js';
import { isConnected, isSharedDatabase } from '../../config/db.js';
import { QueryCase, Notification } from '../../models/index.js';
import { WORKFLOW_STATE } from '../../constants/workflowStates.js';
import { ACTOR_TYPES, ROLES } from '../../constants/roles.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../constants/auditActions.js';
import { allUsers } from '../../constants/users.js';
import * as gemmaService from '../ai/gemmaService.js';
import * as audit from '../audit/auditService.js';
import { change } from '../audit/caseChanges.js';
import { autoTransferSettings, deadlineFrom, sanitizeRanking, TRANSFER_TYPES } from './assignmentClock.js';

const BATCH = 50;

let timer = null;
let inFlight = null;

export function isEligibleOfficial(user) {
  return Boolean(user) && user.role === ROLES.ASSIGNED_OFFICIAL && user.active !== false;
}

export function nextRecommendedOfficial({ ranking, heldIds = [], currentAssigneeId = null, directory = allUsers() }) {
  const held = new Set([...heldIds, currentAssigneeId].filter(Boolean));
  const byId = new Map(directory.map((user) => [user.id, user]));
  for (const entry of ranking) {
    const user = byId.get(entry.userId);
    if (held.has(entry.userId) || !isEligibleOfficial(user)) continue;
    return { user, matchPercent: entry.matchPercent ?? null };
  }
  return null;
}

export function expiredAssignmentFilter(nowIso) {
  return {
    workflowState: WORKFLOW_STATE.ASSIGNED,
    businessStatus: { $ne: 'CLOSED' },
    currentAssigneeId: { $nin: [null, ''] },
    actionDeadline: { $ne: null, $lte: nowIso },
    autoTransferFailed: { $ne: true },
  };
}

async function rankingFor(query) {
  const stored = sanitizeRanking(query.autoTransferRanking);
  if (stored.length) return { ranking: stored, computed: false };
  const recommendations = await gemmaService.recommendOfficial({
    subject: query.subject || '',
    body: query.description || '',
    summaryText: query.aiSummary?.text || '',
  });
  return { ranking: sanitizeRanking(recommendations), computed: true };
}

const nameOf = (userId, directory) => directory.find((user) => user.id === userId)?.name || userId;

async function notify(notification) {
  await Notification.findOneAndUpdate(
    { notificationId: notification.notificationId },
    { $setOnInsert: notification },
    { upsert: true },
  );
}

async function recordExhausted(query, { nowIso, ranking, computed, settings, directory }) {
  const claimed = await QueryCase.findOneAndUpdate(
    {
      queryId: query.queryId,
      workflowState: WORKFLOW_STATE.ASSIGNED,
      currentAssigneeId: query.currentAssigneeId,
      actionDeadline: query.actionDeadline,
      autoTransferFailed: { $ne: true },
    },
    {
      $set: {
        actionDeadline: null,
        autoTransferFailed: true,
        autoTransferFailedAt: nowIso,
        ...(computed ? { autoTransferRanking: ranking } : {}),
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!claimed) return { queryId: query.queryId, outcome: 'SKIPPED', reason: 'CASE_CHANGED' };

  const holder = nameOf(query.currentAssigneeId, directory);
  await audit.record({
    action: AUDIT_ACTIONS.QUERY_AUTO_TRANSFER_FAILED,
    queryId: query.queryId,
    actorType: ACTOR_TYPES.SYSTEM,
    actorRole: 'SYSTEM',
    result: AUDIT_RESULTS.FAILURE,
    details: `Case ID: ${query.queryId} | Held By: ${holder} | Reason: No eligible recommended official remains after the ${settings.timeoutMinutes}-minute action limit`,
  });
  await notify({
    notificationId: `NOTIF-AUTO-FAILED-${query.queryId}-${query.actionDeadline}`,
    queryId: query.queryId,
    recipientRole: ROLES.OFFICER_IN_CHARGE,
    recipientUserId: null,
    title: 'Automatic transfer stopped',
    message: `${query.queryId}: ${holder} took no action within ${settings.timeoutMinutes} minutes and no eligible recommended official remains. The case stays with ${holder}; please reassign it manually.`,
    type: 'WARNING',
    read: false,
    at: nowIso,
  });
  return { queryId: query.queryId, outcome: 'EXHAUSTED' };
}

export async function executeAutoTransfer(
  query,
  { now = Date.now(), settings = autoTransferSettings(), directory = allUsers() } = {},
) {
  const nowIso = new Date(now).toISOString();
  if (!query?.actionDeadline || query.actionDeadline > nowIso) {
    return { queryId: query?.queryId ?? null, outcome: 'SKIPPED', reason: 'NOT_EXPIRED' };
  }

  const { ranking, computed } = await rankingFor(query);
  const heldIds = query.autoTransferHeldIds?.length ? query.autoTransferHeldIds : [query.currentAssigneeId];
  const next = nextRecommendedOfficial({ ranking, heldIds, currentAssigneeId: query.currentAssigneeId, directory });

  if (!next) return recordExhausted(query, { nowIso, ranking, computed, settings, directory });

  const reason = `No action within the ${settings.timeoutMinutes}-minute action limit`;
  const record = {
    fromAssigneeId: query.currentAssigneeId,
    toAssigneeId: next.user.id,
    transferredAt: nowIso,
    transferType: TRANSFER_TYPES.AUTOMATIC,
    reason,
    matchPercent: next.matchPercent,
    byUserId: null,
  };

  const updated = await QueryCase.findOneAndUpdate(
    {
      queryId: query.queryId,
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: { $ne: 'CLOSED' },
      currentAssigneeId: query.currentAssigneeId,
      actionDeadline: query.actionDeadline,
    },
    {
      $set: {
        currentAssigneeId: next.user.id,
        assignedAt: nowIso,
        actionDeadline: deadlineFrom(nowIso, settings.timeoutMinutes),
        lastAutoTransferAt: nowIso,
        transferType: TRANSFER_TYPES.AUTOMATIC,
        autoTransferFailed: false,
        autoTransferFailedAt: null,
        autoTransferHeldIds: [...new Set([...heldIds, query.currentAssigneeId, next.user.id])],
        ...(computed ? { autoTransferRanking: ranking } : {}),
      },
      $inc: { autoTransferCount: 1, revision: 1 },
      $push: { transferHistory: record },
    },
    { returnDocument: 'after' },
  );
  if (!updated) return { queryId: query.queryId, outcome: 'SKIPPED', reason: 'CASE_CHANGED' };

  const from = nameOf(query.currentAssigneeId, directory);
  const to = next.user.name || next.user.id;
  const match = next.matchPercent !== null ? ` | AI Match: ${next.matchPercent}%` : '';
  await audit.record({
    action: AUDIT_ACTIONS.QUERY_AUTO_TRANSFERRED,
    queryId: query.queryId,
    actorType: ACTOR_TYPES.SYSTEM,
    actorRole: 'SYSTEM',
    result: AUDIT_RESULTS.SUCCESS,
    details: `Case ID: ${query.queryId} | Transferred From: ${from} | Transferred To: ${to} | Transferred By: System (automatic) | Reason: ${reason}${match}`,
    changes: change('assignee', query.currentAssigneeId, next.user.id),
  });
  await notify({
    notificationId: `NOTIF-AUTO-${query.queryId}-${updated.autoTransferCount}`,
    queryId: query.queryId,
    recipientRole: null,
    recipientUserId: next.user.id,
    title: 'Query automatically transferred to you',
    message: `${query.queryId} (${query.subject || 'no subject'}) was transferred to you because ${from} took no action within ${settings.timeoutMinutes} minutes. Please act before ${updated.actionDeadline}.`,
    type: 'INFO',
    read: false,
    at: nowIso,
  });

  return {
    queryId: query.queryId,
    outcome: 'TRANSFERRED',
    fromAssigneeId: query.currentAssigneeId,
    toAssigneeId: next.user.id,
    actionDeadline: updated.actionDeadline,
  };
}

export async function processExpiredTransfers({
  now = Date.now(),
  settings = autoTransferSettings(),
  directory = allUsers(),
} = {}) {
  if (!settings.enabled) return { ran: false, reason: 'DISABLED', transferred: 0, exhausted: 0, results: [] };
  if (!isConnected()) return { ran: false, reason: 'DB_DISCONNECTED', transferred: 0, exhausted: 0, results: [] };

  const nowIso = new Date(now).toISOString();
  const expired = await QueryCase.find(expiredAssignmentFilter(nowIso))
    .sort({ actionDeadline: 1 })
    .limit(BATCH)
    .lean();

  const results = [];
  for (const query of expired) {
    try {
      results.push(await executeAutoTransfer(query, { now, settings, directory }));
    } catch (error) {
      results.push({ queryId: query.queryId, outcome: 'ERROR', error: error.message });
    }
  }

  return {
    ran: true,
    scanned: expired.length,
    transferred: results.filter((r) => r.outcome === 'TRANSFERRED').length,
    exhausted: results.filter((r) => r.outcome === 'EXHAUSTED').length,
    results,
  };
}

export async function runAutoTransferSweep(options = {}) {
  if (inFlight) return inFlight;
  inFlight = processExpiredTransfers(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startAutoTransferScheduler({ config = env } = {}) {
  if (timer) return timer;
  if (config.NODE_ENV === 'test') return null;

  const settings = autoTransferSettings(config);
  if (settings.problems.length) {
    console.warn(`[qms] automatic transfer disabled: ${settings.problems.join('; ')}`);
    return null;
  }
  if (!settings.scheduler) return null;

  const shared = isSharedDatabase();
  console.log(
    `[qms] automatic transfer scheduler on: ${settings.timeoutMinutes}-minute action limit, checked every ` +
      `${settings.intervalMs / 1000}s${shared ? ' — against a SHARED database' : ''}`,
  );

  timer = setInterval(() => {
    runAutoTransferSweep({ settings }).catch((error) => {
      console.warn(`[qms] automatic transfer sweep failed: ${error.message}`);
    });
  }, settings.intervalMs);
  timer.unref();
  return timer;
}

export function stopAutoTransferScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function autoTransferSchedulerState() {
  return { running: Boolean(timer), sweeping: Boolean(inFlight) };
}
