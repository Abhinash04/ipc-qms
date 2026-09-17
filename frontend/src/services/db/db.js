import {
  fetchAllQueries,
  checkQueriesEmpty,
  persistQueryTransition,
  resetQueries,
} from '@/services/api/queryCaseService';

const createDefaultStore = () => ({
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

let memoryStore = createDefaultStore();

export const COUNTER_KEY = 'counters';

export async function loadAll() {
  try {
    const data = await fetchAllQueries();
    if (data && Array.isArray(data.queries) && data.queries.length > 0) {
      memoryStore = data;
    }
  } catch (_err) {
    // Backend API unavailable in unit test / offline environment
  }
  return memoryStore;
}

export async function replaceAll(state) {
  memoryStore = JSON.parse(JSON.stringify(state));
  try {
    await resetQueries(state);
  } catch (_err) {
    // Backend API unavailable in unit test / offline environment
  }
  return state;
}

export async function persistTransition(delta) {
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
  } = delta || {};

  if (!memoryStore) memoryStore = createDefaultStore();
  if (!memoryStore.queries) memoryStore.queries = [];
  if (!memoryStore.workflowSteps) memoryStore.workflowSteps = [];
  if (!memoryStore.reviews) memoryStore.reviews = [];
  if (!memoryStore.responseVersions) memoryStore.responseVersions = [];
  if (!memoryStore.auditEvents) memoryStore.auditEvents = [];
  if (!memoryStore.notifications) memoryStore.notifications = [];
  if (!memoryStore.emailMessages) memoryStore.emailMessages = [];
  if (!memoryStore.emailThreads) memoryStore.emailThreads = [];

  if (query) {
    const idx = memoryStore.queries.findIndex((q) => q.queryId === query.queryId);
    if (idx >= 0) memoryStore.queries[idx] = query;
    else memoryStore.queries.push(query);
  }

  if (auditEvent) memoryStore.auditEvents.push(auditEvent);
  if (notification) memoryStore.notifications.push(notification);

  if (upsertSteps.length) {
    for (const step of upsertSteps) {
      const idx = memoryStore.workflowSteps.findIndex((s) => s.stepId === step.stepId);
      if (idx >= 0) memoryStore.workflowSteps[idx] = step;
      else memoryStore.workflowSteps.push(step);
    }
  }

  if (deleteStepIds.length) {
    const delSet = new Set(deleteStepIds);
    memoryStore.workflowSteps = memoryStore.workflowSteps.filter((s) => !delSet.has(s.stepId));
  }

  if (addReviews.length) {
    memoryStore.reviews.push(...addReviews);
  }

  if (addVersions.length || upsertVersions.length) {
    for (const ver of [...addVersions, ...upsertVersions]) {
      const idx = memoryStore.responseVersions.findIndex((v) => v.responseId === ver.responseId);
      if (idx >= 0) memoryStore.responseVersions[idx] = ver;
      else memoryStore.responseVersions.push(ver);
    }
  }

  if (addMessages.length) memoryStore.emailMessages.push(...addMessages);
  if (addThreads.length) memoryStore.emailThreads.push(...addThreads);
  if (counters) memoryStore.counters = counters;

  try {
    await persistQueryTransition(delta);
  } catch (_err) {
    // Backend API unavailable in unit test / offline environment
  }
}

export async function isEmpty() {
  try {
    const empty = await checkQueriesEmpty();
    return empty;
  } catch (_err) {
    return !memoryStore.queries || memoryStore.queries.length === 0;
  }
}
