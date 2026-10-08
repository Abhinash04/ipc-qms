import env from '../../config/env.js';
import { WORKFLOW_STATE } from '../../constants/workflowStates.js';

export const AUTO_TRANSFER_FIELDS = [
  'assignedAt',
  'actionDeadline',
  'lastAutoTransferAt',
  'autoTransferCount',
  'transferType',
  'transferHistory',
  'autoTransferFailed',
  'autoTransferFailedAt',
  'autoTransferRanking',
  'autoTransferHeldIds',
];

export const TRANSFER_TYPES = Object.freeze({
  INITIAL: 'INITIAL_ASSIGNMENT',
  MANUAL: 'MANUAL',
  AUTOMATIC: 'AUTO_TRANSFER',
});

const MAX_RANKING = 20;

export function autoTransferSettings(config = env) {
  const timeoutMinutes = Number(config.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES);
  const intervalSeconds = Number(config.QUERY_AUTO_TRANSFER_INTERVAL_SECONDS);
  const problems = [];
  if (!(Number.isFinite(timeoutMinutes) && timeoutMinutes > 0)) {
    problems.push(`QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES must be a positive number (got "${config.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES}")`);
  }
  if (!(Number.isFinite(intervalSeconds) && intervalSeconds >= 1)) {
    problems.push(`QUERY_AUTO_TRANSFER_INTERVAL_SECONDS must be at least 1 (got "${config.QUERY_AUTO_TRANSFER_INTERVAL_SECONDS}")`);
  }
  const enabled = Boolean(config.QUERY_AUTO_TRANSFER_ENABLED) && problems.length === 0;
  return {
    enabled,
    scheduler: enabled && Boolean(config.QUERY_AUTO_TRANSFER_SCHEDULER),
    timeoutMinutes,
    intervalMs: intervalSeconds * 1000,
    problems,
  };
}

export function deadlineFrom(startIso, minutes) {
  return new Date(Date.parse(startIso) + minutes * 60 * 1000).toISOString();
}

export function sanitizeRanking(ranking) {
  if (!Array.isArray(ranking)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const entry of ranking) {
    const userId = typeof entry?.userId === 'string' ? entry.userId : typeof entry?.id === 'string' ? entry.id : null;
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const percent = Number(entry.matchPercent);
    cleaned.push({ userId, matchPercent: Number.isFinite(percent) ? percent : null });
    if (cleaned.length >= MAX_RANKING) break;
  }
  return cleaned
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.matchPercent ?? -1) - (a.entry.matchPercent ?? -1) || a.index - b.index)
    .map(({ entry }) => entry);
}

export function transferReasonFrom(details) {
  const match = /Reason:\s*([^|]+)/.exec(String(details || ''));
  return match ? match[1].trim() : null;
}

export function assignmentClockUpdate({
  stored,
  next,
  now = Date.now(),
  settings = autoTransferSettings(),
  reason = null,
  actorId = null,
}) {
  const nowIso = new Date(now).toISOString();
  const nextState = next?.workflowState ?? stored?.workflowState ?? null;
  const nextAssignee = next?.currentAssigneeId !== undefined ? next.currentAssigneeId : stored?.currentAssigneeId ?? null;
  const wasAssigned = stored?.workflowState === WORKFLOW_STATE.ASSIGNED;
  const isAssigned = nextState === WORKFLOW_STATE.ASSIGNED && Boolean(nextAssignee);

  if (isAssigned && (!wasAssigned || nextAssignee !== stored?.currentAssigneeId)) {
    const manual = wasAssigned && Boolean(stored?.currentAssigneeId);
    const set = {
      assignedAt: nowIso,
      actionDeadline: settings.enabled ? deadlineFrom(nowIso, settings.timeoutMinutes) : null,
      transferType: manual ? TRANSFER_TYPES.MANUAL : TRANSFER_TYPES.INITIAL,
      autoTransferFailed: false,
      autoTransferFailedAt: null,
    };

    if (!manual) {
      set.autoTransferCount = 0;
      set.autoTransferHeldIds = [nextAssignee];
      set.autoTransferRanking = sanitizeRanking(next?.assignmentDecision?.ranking);
      return { set };
    }

    set.autoTransferHeldIds = [
      ...new Set([...(stored.autoTransferHeldIds || []), stored.currentAssigneeId, nextAssignee]),
    ];
    return {
      set,
      push: {
        transferHistory: {
          fromAssigneeId: stored.currentAssigneeId,
          toAssigneeId: nextAssignee,
          transferredAt: nowIso,
          transferType: TRANSFER_TYPES.MANUAL,
          reason,
          byUserId: actorId,
        },
      },
    };
  }

  if (wasAssigned && !isAssigned && stored?.actionDeadline) {
    return { set: { actionDeadline: null } };
  }

  return null;
}
