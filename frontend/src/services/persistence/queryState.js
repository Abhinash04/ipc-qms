import {
  fetchAllQueries,
  checkQueriesEmpty,
  persistQueryTransition,
  resetQueries,
} from '@/services/api/queryCaseService';
import { notify } from '@/services/notify';

/**
 * The workflow store's persistence client.
 *
 * Mirrors state into `memoryStore` so the UI keeps working when the API is
 * unreachable, then writes through to /queries. The mirror is per-tab memory,
 * not storage: it does not survive a refresh, which is exactly why a write-
 * through failure has to be reported rather than swallowed. Until the server-
 * side Query Case API existed this module was a Dexie/IndexedDB database, and
 * back then a local-only write really was durable.
 */

/**
 * One toast per failure kind, not one per request.
 *
 * A single mailbox sweep issues a dozen transitions; a dozen identical "not
 * saved" toasts is noise that hides the message. Sonner replaces a toast that
 * reuses an id, so the last failure stays on screen and the rest collapse into
 * it.
 */
function reportFailure(error) {
  // 401 is already handled by the axios interceptor, which clears the session
  // and says so. Reporting it again here would stack a second, vaguer toast on
  // top of the accurate one.
  if (error?.response?.status === 401) return;

  const status = error?.response?.status;

  /**
   * A 400 here is a contract mismatch between this client and the server's
   * schema — a bug, not anything the user did or can retry their way out of.
   *
   * `validateBody` answers `{ error, fields: ['auditEvent.event'] }` (field
   * paths only, never values, since a delta carries case content). Showing the
   * field turns an unactionable "changes were not saved" into something a
   * developer can act on from a screenshot, which is how this one was found.
   */
  const fields = error?.response?.data?.fields;

  const detail =
    status === 403
      ? 'This account is not permitted to write that change.'
      : status === 400
        ? `The server rejected this change as malformed${fields?.length ? ` (${fields.join(', ')})` : ''}. This is a bug — please report it.`
        : status === 409
          ? // The server kept the case it already had. This tab minted an id that
            // another one had already used — reloading takes the server's version.
            'That case id already belongs to a different case. Reload to see the saved one.'
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

/**
 * One transition reaches the server at a time, in the order they were made.
 *
 * `applyTransition` does not await `persistDelta` — the UI must not wait on the
 * network — so several writes can be in flight at once. That is a problem here
 * and not elsewhere, because each delta carries the **whole** case document and
 * the server applies it with `$set`: the last response to arrive wins, whatever
 * order it was sent in.
 *
 * One action can emit two transitions. `assignQuery` records the AI
 * recommendation first, carrying the case still unassigned, and then the
 * assignment. Raced, the older document could land second and revert the
 * assignment in the database while the screen showed it made — intermittently,
 * which is the worst way for a bug like this to behave. It was reproduced
 * roughly one run in three.
 *
 * Reads go through the same chain, so a read cannot overtake a write that has
 * not landed yet. `acceptMailboxMessage` and `grantFinalApproval` both re-read
 * the whole state immediately after acting; without this, that read could
 * answer from before an in-flight transition and quietly drop it from the tab.
 *
 * A promise chain rather than a queue object: each call waits for the previous
 * one to settle and nothing is dropped. The chain itself is kept permanently
 * resolved — a link left rejected would skip every write queued behind it, and
 * would surface as an unhandled rejection — while the caller still receives the
 * real outcome of its own work.
 */
let pending = Promise.resolve();

function enqueue(work) {
  const result = pending.then(work, work);
  pending = result.catch(() => {});
  return result;
}

/**
 * Deliberately does not catch, unlike the write paths below.
 *
 * A failed read means the caller is about to render data it never loaded, and
 * only the caller knows what to do about that — `hydrate()` turns the throw
 * into the store's `persistenceError`.
 */
export async function loadAll() {
  // Queued behind any writes still in flight — see `enqueue`. A hydrate at
  // startup has nothing to wait for; a refresh straight after an accept does.
  const data = await enqueue(fetchAllQueries);

  /**
   * A successful read replaces the mirror, even when it holds no cases.
   *
   * This used to require `queries.length > 0`, which discarded everything else
   * the response carried: a database with no cases yet still has a
   * `QueryCounter`, and dropping it left the store on the zeroed seed counter.
   * The next case then minted an id the server had already issued. "No cases"
   * is data; only a thrown request is an absence of data, and that throws.
   */
  if (data && Array.isArray(data.queries)) {
    memoryStore = data;
  }
  return memoryStore;
}

/**
 * The server first; the local mirror only once it agreed — and the failure is
 * re-thrown rather than absorbed.
 *
 * The opposite order for a destructive write is how the Reset button managed to
 * be harmful to a user who was not allowed to press it: the API answered 403,
 * but this had already emptied the mirror, so the tab carried on against zeroed
 * counters while the server still held every real case. Unlike `persistTransition`
 * below, nothing has happened on screen yet that undoing would contradict.
 */
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

  // The local mirror is updated first and kept whatever happens: the user's
  // action already took effect on screen and undoing it would be worse than a
  // stale tab. The write-through failure is reported instead of swallowed.
  return enqueue(async () => {
    try {
      await persistQueryTransition(delta);
    } catch (error) {
      reportFailure(error);
    }
  });
}

export async function isEmpty() {
  try {
    return await checkQueriesEmpty();
  } catch {
    // Not reported: `hydrate()` calls this first, and `loadAll()` immediately
    // after will throw on the same outage with the caller ready to handle it.
    // Two toasts for one outage helps nobody.
    return !memoryStore.queries || memoryStore.queries.length === 0;
  }
}
