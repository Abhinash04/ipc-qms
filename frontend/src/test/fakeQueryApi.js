import { PullbackError, planPullback } from '../../../backend/src/services/workflow/pullbackPlan.js';
import { findUserById } from '@/constants/mockUsers';

const empty = () => ({
  queries: [],
  workflowSteps: [],
  reviews: [],
  responseVersions: [],
  auditEvents: [],
  notifications: [],
  emailMessages: [],
  emailThreads: [],
  outboundEmails: [],
  counters: null,
});

let state = empty();

const clone = (value) => JSON.parse(JSON.stringify(value));

function upsert(collection, key, row) {
  const idx = collection.findIndex((existing) => existing[key] === row[key]);
  if (idx >= 0) collection[idx] = clone(row);
  else collection.push(clone(row));
}

export async function fetchAllQueries() {
  return clone(state);
}

export async function checkQueriesEmpty() {
  return state.queries.length === 0;
}

export async function persistQueryTransition(delta = {}) {
  const {
    query,
    auditEvent,
    notification,
    counters,
    upsertSteps = [],
    deleteStepIds = [],
    addReviews = [],
    addVersions = [],
    upsertVersions = [],
    addMessages = [],
    addThreads = [],
  } = delta;

  if (query?.queryId) upsert(state.queries, 'queryId', query);
  if (notification?.notificationId) upsert(state.notifications, 'notificationId', notification);

  if (auditEvent?.event) state.auditEvents.push(clone(auditEvent));

  for (const step of upsertSteps) upsert(state.workflowSteps, 'stepId', step);

  if (deleteStepIds.length) {
    const doomed = new Set(deleteStepIds);
    state.workflowSteps = state.workflowSteps.filter((step) => !doomed.has(step.stepId));
  }

  for (const review of addReviews) upsert(state.reviews, 'reviewId', review);
  for (const version of [...addVersions, ...upsertVersions]) {
    upsert(state.responseVersions, 'responseId', version);
  }
  for (const message of addMessages) upsert(state.emailMessages, 'messageId', message);
  for (const thread of addThreads) upsert(state.emailThreads, 'threadId', thread);

  if (counters) state.counters = clone(counters);

  return { success: true };
}

const pad = (n) => String(n).padStart(5, '0');

const stepNumber = (stepId) => Number(/^STEP-(\d+)$/.exec(stepId || '')?.[1] ?? 0);

const refusal = (status, code, error) => Object.assign(new Error(error), { response: { status, data: { error, code } } });

export async function pullBackQuery(queryId, body = {}, actor = null) {
  const query = state.queries.find((q) => q.queryId === queryId);
  if (!query) throw refusal(404, 'NOT_FOUND', `No query case ${queryId}`);

  let plan;
  try {
    plan = planPullback({
      query,
      steps: state.workflowSteps.filter((step) => step.queryId === queryId),
      ...body,
      actor,
      now: Date.now(),
      findUser: findUserById,
    });
  } catch (error) {
    if (error instanceof PullbackError) throw refusal(error.status, error.code, error.message);
    throw error;
  }

  let next = Math.max(state.counters?.STEP || 0, ...state.workflowSteps.map((step) => stepNumber(step.stepId)));
  const newSteps = plan.newSteps.map((step) => ({ ...step, stepId: `STEP-${pad((next += 1))}` }));
  state.counters = { ...(state.counters || {}), STEP: next };

  const superseded = new Set(plan.supersededStepIds);
  state.workflowSteps = [
    ...state.workflowSteps.map((step) =>
      step.queryId === queryId && superseded.has(step.stepId)
        ? { ...step, status: 'SUPERSEDED', supersededAt: plan.patch.updatedAt }
        : step,
    ),
    ...clone(newSteps),
  ];

  const currentWorkflowStepId = plan.currentIndex >= 0 ? newSteps[plan.currentIndex].stepId : null;
  upsert(state.queries, 'queryId', {
    ...query,
    ...plan.patch,
    ...(plan.clock?.set || {}),
    currentWorkflowStepId,
    pullbackHistory: [...(query.pullbackHistory || []), plan.history],
    revision: (query.revision ?? 0) + 1,
  });
  upsert(state.notifications, 'notificationId', plan.notification);
  state.auditEvents.push({
    auditId: `AUD-${queryId}-PB-${plan.history.toCycle}`,
    queryId,
    event: 'QUERY_PULLED_BACK',
    actor: actor?.role ?? null,
    at: plan.patch.updatedAt,
    details: plan.auditDetails,
  });

  return {
    success: true,
    queryId,
    targetStage: body.targetStage,
    reviewLevel: plan.reviewLevel,
    reviewCycle: plan.patch.reviewCycle,
    currentWorkflowStepId,
  };
}

export async function grantFinalApproval(queryId) {
  throw new Error(
    `fakeQueryApi: no final-approval endpoint was injected for ${queryId} — ` +
      'pass fakeFinalApprovalEndpoint() as the third argument to grantFinalApproval',
  );
}

export function recordOutbound(row) {
  upsert(state.outboundEmails, 'dispatchKey', { ...row, dispatchKey: `${row.emailType}:${row.queryId}` });
}

let outboundResolver = null;

export function __setOutboundResolver(resolve) {
  outboundResolver = resolve;
}

export async function resolveOutboundEmail(queryId, body) {
  if (!outboundResolver) {
    throw new Error(
      `fakeQueryApi: no resolve endpoint is installed for ${queryId} — ` +
        'call installFakeCaseMail(mailboxService) first',
    );
  }
  return outboundResolver(queryId, body);
}

export async function resetQueries(seed = {}) {
  state = { ...empty(), ...clone(seed) };
  return { success: true };
}

export function __resetFakeQueryApi() {
  state = empty();
  outboundResolver = null;
}
