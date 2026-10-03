import { BUSINESS_STATUS, WORKFLOW_STATE } from '../../constants/workflowStates.js';

export const PULLBACK_RANK = Object.freeze({
  [WORKFLOW_STATE.RECEIVED]: 0,
  [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION]: 1,
  [WORKFLOW_STATE.PENDING_ASSIGNMENT]: 2,
  [WORKFLOW_STATE.ASSIGNED]: 3,
  [WORKFLOW_STATE.DRAFTING]: 4,
  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: 4,
  [WORKFLOW_STATE.UNDER_REVIEW]: 5,
  [WORKFLOW_STATE.PENDING_FINAL_APPROVAL]: 6,
});

export const STEP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SUPERSEDED: 'SUPERSEDED',
});

const PRE_ASSIGNMENT = new Set([
  WORKFLOW_STATE.RECEIVED,
  WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
  WORKFLOW_STATE.PENDING_ASSIGNMENT,
]);

const LEVEL_NAMES = ['Reviewer I', 'Reviewer II', 'Reviewer III'];
export const reviewLevelName = (index) => LEVEL_NAMES[index] || `Reviewer ${index + 1}`;

export const cycleOfQuery = (query) => query?.reviewCycle ?? 0;
export const cycleOfStep = (step) => step?.cycle ?? 0;

export function cycleFilter(cycle) {
  return cycle === 0 ? { $in: [0, null] } : cycle;
}

export function activeSteps(steps, query) {
  const cycle = cycleOfQuery(query);
  return (steps || [])
    .filter((step) => step.queryId === query.queryId && cycleOfStep(step) === cycle)
    .sort((a, b) => a.sequence - b.sequence);
}

export const isPullbackSource = (state) => state in PULLBACK_RANK;

const businessStatusFor = (state) =>
  state === WORKFLOW_STATE.RECEIVED ? BUSINESS_STATUS.OPEN : BUSINESS_STATUS.IN_PROGRESS;

export class PullbackError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function reviewLevelTargets(query, steps) {
  const chain = activeSteps(steps, query).filter((step) => step.stepType === 'REVIEW');
  if (query.workflowState === WORKFLOW_STATE.PENDING_FINAL_APPROVAL) return chain;
  if (query.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return [];
  const current = chain.findIndex((step) => step.stepId === query.currentWorkflowStepId);
  return current > 0 ? chain.slice(0, current) : [];
}

function recipientRoleFor(target) {
  if (target === WORKFLOW_STATE.RECEIVED || target === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION) return 'FRONT_OFFICE';
  if (
    target === WORKFLOW_STATE.ASSIGNED ||
    target === WORKFLOW_STATE.DRAFTING ||
    target === WORKFLOW_STATE.RETURNED_FOR_REVISION
  ) {
    return 'ASSIGNED_OFFICIAL';
  }
  if (target === WORKFLOW_STATE.UNDER_REVIEW) return 'REVIEWER';
  return 'OFFICER_IN_CHARGE';
}

const nameWith = (lookup) => (userId, fallback = 'Unassigned') => lookup(userId)?.name || userId || fallback;

function carried(step, cycle, nowIso) {
  return {
    queryId: step.queryId,
    stepType: step.stepType,
    sequence: step.sequence,
    assignedUserId: step.assignedUserId ?? null,
    cycle,
    createdAt: nowIso,
    supersededAt: null,
  };
}

function cloneChain({ query, steps, reviewStepId, toCycle, nowIso }) {
  const active = activeSteps(steps, query);
  const chain = active.filter((step) => step.stepType === 'REVIEW');
  const allowed = reviewLevelTargets(query, steps);
  const level = chain.findIndex((step) => step.stepId === reviewStepId);

  if (!reviewStepId || level === -1) {
    throw new PullbackError(
      'Choose which review level the query should return to.',
      400,
      'REVIEW_LEVEL_REQUIRED',
    );
  }
  if (!allowed.some((step) => step.stepId === reviewStepId)) {
    throw new PullbackError(
      `${reviewLevelName(level)} is not an earlier review level for ${query.queryId}.`,
      409,
      'INVALID_REVIEW_LEVEL',
    );
  }

  const draft = active.find((step) => step.stepType === 'DRAFT');
  const final = active.find((step) => step.stepType === 'FINAL_APPROVAL');

  const newSteps = [];
  if (draft) {
    newSteps.push({
      ...carried(draft, toCycle, nowIso),
      status: STEP_STATUS.COMPLETED,
      carriedOver: true,
      startedAt: draft.startedAt ?? null,
      completedAt: draft.completedAt ?? nowIso,
    });
  }

  let current = -1;
  chain.forEach((step, index) => {
    if (index < level) {
      newSteps.push({
        ...carried(step, toCycle, nowIso),
        status: STEP_STATUS.COMPLETED,
        carriedOver: true,
        startedAt: step.startedAt ?? null,
        completedAt: step.completedAt ?? nowIso,
      });
      return;
    }
    if (index === level) current = newSteps.length;
    newSteps.push({
      ...carried(step, toCycle, nowIso),
      status: index === level ? STEP_STATUS.IN_PROGRESS : STEP_STATUS.PENDING,
      carriedOver: false,
      startedAt: index === level ? nowIso : null,
      completedAt: null,
    });
  });

  if (final) {
    newSteps.push({
      ...carried(final, toCycle, nowIso),
      status: STEP_STATUS.PENDING,
      carriedOver: false,
      startedAt: null,
      completedAt: null,
    });
  }

  return { newSteps, currentIndex: current, reviewLevel: reviewLevelName(level), reviewerId: chain[level].assignedUserId };
}

export function planPullback({
  query,
  steps = [],
  targetStage,
  reviewStepId = null,
  reason,
  remarks = '',
  actor,
  now = Date.now(),
  findUser = () => null,
  clockUpdate = () => null,
}) {
  const nowIso = new Date(now).toISOString();
  const nameOf = nameWith(findUser);
  const fromStage = query.workflowState;

  if (!isPullbackSource(fromStage)) {
    throw new PullbackError(
      `${query.queryId} is ${fromStage} — a query cannot be pulled back once it has been finally approved or dispatched.`,
      409,
      'PULLBACK_NOT_ALLOWED',
    );
  }
  const reReview = targetStage === WORKFLOW_STATE.UNDER_REVIEW && fromStage === WORKFLOW_STATE.UNDER_REVIEW;
  if (!(targetStage in PULLBACK_RANK) || (!reReview && PULLBACK_RANK[targetStage] >= PULLBACK_RANK[fromStage])) {
    throw new PullbackError(
      `${query.queryId} cannot be pulled back from ${fromStage} to ${targetStage}: choose an earlier stage.`,
      409,
      'INVALID_TARGET',
    );
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new PullbackError('A reason for pullback is required.', 400, 'REASON_REQUIRED');
  const trimmedRemarks = String(remarks || '').trim();

  const fromCycle = cycleOfQuery(query);
  const toCycle = fromCycle + 1;
  const active = activeSteps(steps, query);
  const supersededStepIds = active
    .filter((step) => step.status === STEP_STATUS.PENDING || step.status === STEP_STATUS.IN_PROGRESS)
    .map((step) => step.stepId);

  const newAssigneeId = PRE_ASSIGNMENT.has(targetStage) ? null : query.currentAssigneeId ?? null;

  let newSteps = [];
  let currentIndex = -1;
  let reviewLevel = null;
  let reviewerId = null;
  if (targetStage === WORKFLOW_STATE.UNDER_REVIEW) {
    ({ newSteps, currentIndex, reviewLevel, reviewerId } = cloneChain({ query, steps, reviewStepId, toCycle, nowIso }));
  }

  const patch = {
    workflowState: targetStage,
    businessStatus: businessStatusFor(targetStage),
    currentAssigneeId: newAssigneeId,
    currentWorkflowStepId: null,
    reviewCycle: toCycle,
    updatedAt: nowIso,
  };

  const clock = clockUpdate({
    stored: query,
    next: { ...patch, assignmentDecision: query.assignmentDecision },
    now,
    actorId: actor?.id ?? null,
  });

  const actorLabel = actor?.name || nameOf(actor?.id, 'System');
  const target = reviewLevel ? `${targetStage} (${reviewLevel})` : targetStage;

  const history = {
    fromStage,
    toStage: targetStage,
    toReviewLevel: reviewLevel,
    fromCycle,
    toCycle,
    pulledBackBy: actor?.id || null,
    pulledBackByName: actorLabel,
    pulledBackByRole: actor?.role ?? null,
    reason: trimmedReason,
    remarks: trimmedRemarks,
    previousAssigneeId: query.currentAssigneeId ?? null,
    previousAssignee: nameOf(query.currentAssigneeId),
    newAssigneeId,
    newAssignee: nameOf(newAssigneeId),
    pulledBackAt: nowIso,
  };

  const auditDetails =
    `From: ${fromStage} | Pulled Back To: ${target} | Pulled Back By: ${actorLabel}${actor?.role ? ` (${actor.role})` : ''} | Reason: ${trimmedReason}` +
    (trimmedRemarks ? ` | Remarks: ${trimmedRemarks}` : '') +
    ` | Assignee: ${history.previousAssignee} → ${history.newAssignee}` +
    ` | Review cycle: ${fromCycle} → ${toCycle}`;

  const recipientUserId = reviewerId || (newAssigneeId && !PRE_ASSIGNMENT.has(targetStage) ? newAssigneeId : null);
  const notification = {
    notificationId: `NOTIF-PULLBACK-${query.queryId}-${toCycle}`,
    queryId: query.queryId,
    recipientRole: recipientRoleFor(targetStage),
    recipientUserId,
    title: 'Query pulled back',
    message: `Query ${query.queryId} was pulled back from ${fromStage} to ${target} by ${actorLabel}. Reason: ${trimmedReason}`,
    type: 'WARNING',
    read: false,
    at: nowIso,
  };

  return { patch, clock, newSteps, currentIndex, supersededStepIds, history, auditDetails, notification, reviewLevel };
}

