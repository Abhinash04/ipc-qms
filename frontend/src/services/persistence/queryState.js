import {
  fetchAllQueries,
  checkQueriesEmpty,
  persistQueryTransition,
  resetQueries,
} from '@/services/api/queryCaseService';
import { notify } from '@/services/notify';

function reportFailure(error) {
  if (error?.response?.status === 401) return;

  const status = error?.response?.status;

  const fields = error?.response?.data?.fields;

  const detail =
    status === 403
      ? 'This account is not permitted to write that change.'
      : status === 400
        ? `The server rejected this change as malformed${fields?.length ? ` (${fields.join(', ')})` : ''}. This is a bug — please report it.`
        : status === 409
          ? error?.response?.data?.error || 'The server refused this change.'
          : status === 503
            ? 'The server cannot reach its database.'
            : 'Recent changes are held in this tab only and will be lost on refresh.';

  notify.error('Changes were not saved', detail, { id: 'query-persistence-failed' });
}

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

const CONFLICT_CODES = new Set(['STALE_CASE', 'ID_COLLISION']);

let pending = Promise.resolve();
let writes = 0;
let generation = 0;
const refused = new Map();

function enqueue(work) {
  const result = pending.then(work, work);
  pending = result.catch(() => {});
  return result;
}

export const settled = () => pending;

export async function loadAll() {
  let seen;
  let data;
  do {
    seen = writes;
    data = await enqueue(fetchAllQueries);
  } while (seen !== writes);

  if (data && Array.isArray(data.queries)) {
    memoryStore = data;
    generation += 1;
  }
  return memoryStore;
}

export async function replaceAll(state) {
  try {
    await resetQueries(state);
  } catch (error) {
    reportFailure(error);
    throw error;
  }
  memoryStore = JSON.parse(JSON.stringify(state));
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

  const queryId = query?.queryId;
  const builtIn = generation;
  writes += 1;
  return enqueue(async () => {
    if (queryId && refused.get(queryId) >= builtIn) return { ok: false };
    try {
      await persistQueryTransition(delta);
      return { ok: true };
    } catch (error) {
      if (queryId) refused.set(queryId, builtIn);
      const code = error?.response?.data?.code;
      if (error?.response?.status === 409 && CONFLICT_CODES.has(code)) {
        return { ok: false, conflict: code };
      }
      reportFailure(error);
      return { ok: false };
    }
  });
}

export async function isEmpty() {
  try {
    return await checkQueriesEmpty();
  } catch {
    return !memoryStore.queries || memoryStore.queries.length === 0;
  }
}
