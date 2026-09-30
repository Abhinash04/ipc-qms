import env from '../../config/env.js';
import { isConnected } from '../../config/db.js';
import { QueryCase, Notification, AuditEvent, EmailMessage } from '../../models/index.js';
import { WORKFLOW_STATE } from '../../constants/workflowStates.js';
import { ACTOR_TYPES, ROLES } from '../../constants/roles.js';
import { USERS, findUserById } from '../../constants/users.js';
import * as gemmaService from '../ai/gemmaService.js';
import * as audit from '../audit/auditService.js';

let schedulerTimer = null;
let isProcessing = false;

export const MAX_AUTO_TRANSFERS = 1;

export function getTimeoutMinutes() {
  return env.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES || 2;
}

export function calculateDeadline(assignedAt, timeoutMinutes = getTimeoutMinutes()) {
  const start = assignedAt ? new Date(assignedAt).getTime() : Date.now();
  const deadlineMs = start + timeoutMinutes * 60 * 1000;
  return new Date(deadlineMs).toISOString();
}

export function selectNextRecommendedOfficial({ query, currentAssigneeId, recommendations = [] }) {
  const allAssignedOfficials = USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);
  if (allAssignedOfficials.length === 0) return null;

  const history = Array.isArray(query?.transferHistory) ? query.transferHistory : [];
  const assignedSet = new Set();
  if (currentAssigneeId) assignedSet.add(currentAssigneeId);

  for (const record of history) {
    if (record?.fromAssigneeId) assignedSet.add(record.fromAssigneeId);
    if (record?.toAssigneeId) assignedSet.add(record.toAssigneeId);
  }

  if (Array.isArray(recommendations) && recommendations.length > 0) {
    for (const rec of recommendations) {
      const candidateId = rec.userId || rec.id;
      if (!candidateId || candidateId === currentAssigneeId) continue;

      const userObj = findUserById(candidateId);
      if (!userObj || userObj.role !== ROLES.ASSIGNED_OFFICIAL) continue;

      if (!assignedSet.has(candidateId)) {
        return { selected: userObj, source: 'AI_RECOMMENDATION', matchPercent: rec.matchPercent || null };
      }
    }
  }

  const unassignedColleague = allAssignedOfficials.find((u) => u.id !== currentAssigneeId && !assignedSet.has(u.id));
  if (unassignedColleague) {
    return { selected: unassignedColleague, source: 'DIRECTORY_FALLBACK' };
  }

  const anyOtherColleague = allAssignedOfficials.find((u) => u.id !== currentAssigneeId);
  if (anyOtherColleague) {
    return { selected: anyOtherColleague, source: 'DIRECTORY_REPEAT' };
  }

  return null;
}

export async function executeAutoTransfer(query, { timeoutMinutes = getTimeoutMinutes(), nowISO = new Date().toISOString() } = {}) {
  const queryId = typeof query === 'string' ? query : (query?.queryId || null);
  if (!queryId && typeof query !== 'object') return { success: false, reason: 'INVALID_QUERY_ID' };

  let freshQuery = null;
  if (isConnected()) {
    freshQuery = await QueryCase.findOne({ queryId }).lean();
  } else if (typeof query === 'object' && query !== null) {
    freshQuery = query;
  }

  if (!freshQuery) return { success: false, reason: 'QUERY_NOT_FOUND' };
  if (freshQuery.workflowState !== WORKFLOW_STATE.ASSIGNED) return { success: false, reason: 'STATE_NOT_ASSIGNED' };
  if (freshQuery.businessStatus === 'CLOSED') return { success: false, reason: 'QUERY_CLOSED' };
  if (!freshQuery.currentAssigneeId) return { success: false, reason: 'NO_ASSIGNEE' };
  if ((freshQuery.autoTransferCount || 0) >= MAX_AUTO_TRANSFERS) return { success: false, reason: 'MAX_AUTO_TRANSFERS_REACHED' };

  const effectiveAssignedAt = freshQuery.assignedAt || freshQuery.createdAt || nowISO;
  const effectiveDeadline = freshQuery.actionDeadline || calculateDeadline(effectiveAssignedAt, timeoutMinutes);

  if (new Date(nowISO).getTime() < new Date(effectiveDeadline).getTime()) {
    return { success: false, reason: 'DEADLINE_NOT_EXPIRED', deadline: effectiveDeadline };
  }

  const currentAssigneeId = freshQuery.currentAssigneeId;
  const prevUser = findUserById(currentAssigneeId);
  const prevName = prevUser?.name || currentAssigneeId;

  let recommendations = [];
  try {
    recommendations = await gemmaService.recommendOfficial({
      subject: freshQuery.subject || '',
      body: freshQuery.description || '',
      summaryText: freshQuery.aiSummary?.text || '',
    });
  } catch (err) {
    console.warn(`[AutoTransfer] Recommendation lookup warning for ${queryId}: ${err.message}`);
  }

  const selection = selectNextRecommendedOfficial({
    query: freshQuery,
    currentAssigneeId,
    recommendations,
  });

  if (!selection || !selection.selected) {
    if (isConnected()) {
      await QueryCase.updateOne({ queryId }, { $set: { autoTransferFailed: true } }).catch(() => {});
      const failNotifId = `NOTIF-FAIL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await Notification.create({
        notificationId: failNotifId,
        queryId,
        recipientRole: ROLES.OFFICER_IN_CHARGE,
        recipientUserId: null,
        title: 'Automatic Transfer Failed',
        message: `Query ${queryId} reached the ${timeoutMinutes}-minute action limit, but no eligible recommendation officer was available.`,
        type: 'WARNING',
        read: false,
        at: nowISO,
      }).catch(() => {});
    }
    return { success: false, reason: 'NO_ELIGIBLE_OFFICER_AVAILABLE' };
  }

  const nextOfficer = selection.selected;
  const newName = nextOfficer.name || nextOfficer.id;
  const newAssignedAt = nowISO;
  const newActionDeadline = calculateDeadline(newAssignedAt, timeoutMinutes);
  const reasonText = `Automatic transfer after ${timeoutMinutes}-minute action limit`;

  const transferRecord = {
    fromAssigneeId: currentAssigneeId,
    toAssigneeId: nextOfficer.id,
    transferredAt: nowISO,
    reason: reasonText,
    transferType: 'AUTO_TRANSFER',
  };

  let updated = null;
  if (isConnected()) {
    updated = await QueryCase.findOneAndUpdate(
      {
        queryId,
        workflowState: WORKFLOW_STATE.ASSIGNED,
        businessStatus: { $ne: 'CLOSED' },
        currentAssigneeId: currentAssigneeId,
        revision: freshQuery.revision ?? 0,
      },
      {
        $set: {
          currentAssigneeId: nextOfficer.id,
          assignedAt: newAssignedAt,
          actionDeadline: newActionDeadline,
          lastAutoTransferAt: nowISO,
          transferType: 'AUTO_TRANSFER',
          autoTransferFailed: false,
        },
        $inc: { autoTransferCount: 1, revision: 1 },
        $push: { transferHistory: transferRecord },
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return { success: false, reason: 'RACE_CONDITION_PREVENTED' };
    }
  } else {
    updated = {
      ...freshQuery,
      currentAssigneeId: nextOfficer.id,
      assignedAt: newAssignedAt,
      actionDeadline: newActionDeadline,
      lastAutoTransferAt: nowISO,
      transferType: 'AUTO_TRANSFER',
      autoTransferCount: (freshQuery.autoTransferCount || 0) + 1,
      transferHistory: [...(freshQuery.transferHistory || []), transferRecord],
      autoTransferFailed: false,
    };
  }

  const auditDetails = `Case ID: ${queryId} | Transferred From: ${prevName} | Transferred To: ${newName} | Transferred By: System (Auto-Transfer) | Reason: ${reasonText} | Transfer Type: AUTO_TRANSFER`;

  if (isConnected()) {
    await audit.record({
      action: 'QUERY_TRANSFERRED',
      auditId: `AUD-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      timestamp: nowISO,
      queryId,
      actorType: ACTOR_TYPES.SYSTEM,
      actorRole: 'SYSTEM',
      details: auditDetails,
    }).catch(() => {});

    const notificationId = `NOTIF-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await Notification.create({
      notificationId,
      queryId,
      recipientUserId: nextOfficer.id,
      recipientRole: null,
      title: 'Query Automatically Transferred',
      message: `Query ${queryId} (${freshQuery.subject}) was automatically transferred to ${newName} because ${prevName} did not take action within the ${timeoutMinutes}-minute limit. Reason: ${reasonText}`,
      type: 'INFO',
      read: false,
      at: nowISO,
    }).catch(() => {});

    const messageId = `MSG-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await EmailMessage.create({
      messageId,
      threadId: freshQuery.threadId || `TRD-${queryId}`,
      queryId,
      direction: 'OUTBOUND',
      emailType: 'TRANSFER_NOTIFICATION',
      from: 'System (Auto-Transfer)',
      to: [nextOfficer.email || `${nextOfficer.id}@ipc.example`],
      subject: `Query ${queryId} Transferred: ${freshQuery.subject}`,
      body: `Query ${queryId} ("${freshQuery.subject}") has been automatically transferred to you.\n\nPrevious Assignee: ${prevName}\nTransfer Reason: ${reasonText}\nDate & Time: ${new Date(nowISO).toLocaleString()}`,
      timestamp: nowISO,
    }).catch(() => {});
  }

  return {
    success: true,
    queryId,
    previousAssigneeId: currentAssigneeId,
    newAssigneeId: nextOfficer.id,
    transferredTo: newName,
    assignedAt: newAssignedAt,
    actionDeadline: newActionDeadline,
    updated,
  };
}

export async function processExpiredTransfers({ now = Date.now(), timeoutMinutes = getTimeoutMinutes() } = {}) {
  if (!isConnected()) return { ran: false, reason: 'DB_DISCONNECTED', processed: 0 };

  const nowISO = new Date(now).toISOString();

  const assignedQueries = await QueryCase.find({
    workflowState: WORKFLOW_STATE.ASSIGNED,
    businessStatus: { $ne: 'CLOSED' },
    currentAssigneeId: { $ne: null },
  }).lean();

  let scanned = 0;
  let transferred = 0;
  const results = [];

  for (const q of assignedQueries) {
    if ((q.autoTransferCount || 0) >= MAX_AUTO_TRANSFERS) continue;
    scanned += 1;
    let assignedAt = q.assignedAt;
    let actionDeadline = q.actionDeadline;

    if (!assignedAt || !actionDeadline) {
      assignedAt = q.createdAt || nowISO;
      actionDeadline = calculateDeadline(assignedAt, timeoutMinutes);

      await QueryCase.updateOne(
        { queryId: q.queryId, assignedAt: null },
        { $set: { assignedAt, actionDeadline } }
      );
    }

    if (new Date(nowISO).getTime() >= new Date(actionDeadline).getTime()) {
      const res = await executeAutoTransfer(q.queryId, { timeoutMinutes, nowISO });
      results.push(res);
      if (res.success) transferred += 1;
    }
  }

  return { ran: true, scanned, transferred, results };
}

export function startAutoTransferScheduler({ intervalMs = 10000 } = {}) {
  if (schedulerTimer) return schedulerTimer;

  schedulerTimer = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processExpiredTransfers();
    } catch (err) {
      console.warn(`[AutoTransferScheduler] Tick error: ${err.message}`);
    } finally {
      isProcessing = false;
    }
  }, intervalMs);

  schedulerTimer.unref();
  return schedulerTimer;
}

export function stopAutoTransferScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export function autoTransferSchedulerState() {
  return { running: Boolean(schedulerTimer), isProcessing };
}

export default {
  getTimeoutMinutes,
  calculateDeadline,
  selectNextRecommendedOfficial,
  executeAutoTransfer,
  processExpiredTransfers,
  startAutoTransferScheduler,
  stopAutoTransferScheduler,
  autoTransferSchedulerState,
};
