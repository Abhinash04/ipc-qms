
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
