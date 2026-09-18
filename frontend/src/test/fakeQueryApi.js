/**
 * An in-process stand-in for `@/services/api/queryCaseService`.
 *
 * Without it the suite makes real XHRs to localhost:5000 — the workflow store
 * hydrates through /queries, and nothing else mocks that module. Every call
 * failed, `queryState.js` fell back to its local mirror, and the assertions
 * still passed, which is how three tests named for surviving a reload ended up
 * reading back the same in-process object they had just written.
 *
 * So this is not a silencer. It keeps its own state and applies the same
 * upsert-by-id semantics as `backend/src/controllers/queryController.js`, which
 * makes `loadAll()` a genuine round trip through a boundary again.
 */

const empty = () => ({
  queries: [],
  workflowSteps: [],
  reviews: [],
  responseVersions: [],
  auditEvents: [],
  notifications: [],
  emailMessages: [],
  emailThreads: [],
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

  // The server derives the actor from the session and stores `action`; the
  // client reads `event`. `loadAllQueries` maps back on the way out, so the
  // fake returns the client shape for the same reason.
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

/**
 * `useWorkflowStore` imports this as the default `approve` for
 * `grantFinalApproval`, and a default parameter is evaluated on entry — so the
 * export has to exist even for the calls that are about to be refused, or the
 * mock throws "No grantFinalApproval export" before `assertCan` ever runs and
 * every RBAC refusal fails for the wrong reason.
 *
 * It is deliberately inert. Approving for real needs the whole server sequence
 * — lock the version, send, close — and that lives in
 * `src/test/fakeFinalApprovalEndpoint.js`, which a test injects as the third
 * argument when it means to approve rather than to be refused.
 */
export async function grantFinalApproval(queryId) {
  throw new Error(
    `fakeQueryApi: no final-approval endpoint was injected for ${queryId} — ` +
      'pass fakeFinalApprovalEndpoint() as the third argument to grantFinalApproval',
  );
}

export async function resetQueries(seed = {}) {
  state = { ...empty(), ...clone(seed) };
  return { success: true };
}

/** Called from the global test setup so state does not leak between tests. */
export function __resetFakeQueryApi() {
  state = empty();
}
