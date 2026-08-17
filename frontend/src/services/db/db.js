import Dexie from 'dexie';

/**
 * IndexedDB persistence for the QMS workflow domain.
 *
 * Dexie is the **system of record**: every workflow transition is written here
 * inside a single transaction (see `useWorkflowStore.applyTransition`), and the
 * Zustand store mirrors the tables in memory so components keep reading
 * synchronously. IndexedDB (rather than localStorage) because the domain has
 * genuinely relational slices worth indexing, grows unbounded with audit
 * events, and will need to hold real attachment blobs once file upload lands.
 *
 * Table keys mirror the entity IDs documented in docs/srs/13-data-model.md.
 * Indexes are chosen for the queries the UI actually runs: filtering lists by
 * workflow state, resolving a query's steps/versions/audit, and the per-user
 * "My Work" lookups.
 */
export const db = new Dexie('qms');

db.version(1).stores({
  // `&` = unique primary key; remaining entries are secondary indexes.
  queries: '&queryId, workflowState, businessStatus, priority, currentAssigneeId, currentWorkflowStepId, updatedAt',
  workflowSteps: '&stepId, queryId, stepType, status, assignedUserId, sequence, [queryId+sequence]',
  reviews: '&reviewId, queryId, stepId, reviewerId, decision, at',
  responseVersions: '&responseId, queryId, version, createdAt',
  auditEvents: '&auditId, queryId, event, actor, at',
  notifications: '&notificationId, queryId, recipientRole, at',
  // Single-row table holding the ID counters, so minted IDs stay sequential
  // across reloads. Fixed key 'singleton'.
  meta: '&key',
});

export const COUNTER_KEY = 'counters';

/** Read the whole domain in one consistent transaction. */
export async function loadAll() {
  return db.transaction(
    'r',
    [db.queries, db.workflowSteps, db.reviews, db.responseVersions, db.auditEvents, db.notifications, db.meta],
    async () => ({
      queries: await db.queries.toArray(),
      workflowSteps: await db.workflowSteps.toArray(),
      reviews: await db.reviews.toArray(),
      responseVersions: await db.responseVersions.toArray(),
      auditEvents: await db.auditEvents.toArray(),
      notifications: await db.notifications.toArray(),
      counters: (await db.meta.get(COUNTER_KEY))?.value ?? null,
    }),
  );
}

/** Replace the entire database contents (seed / reset). */
export async function replaceAll(state) {
  return db.transaction(
    'rw',
    [db.queries, db.workflowSteps, db.reviews, db.responseVersions, db.auditEvents, db.notifications, db.meta],
    async () => {
      await Promise.all([
        db.queries.clear(),
        db.workflowSteps.clear(),
        db.reviews.clear(),
        db.responseVersions.clear(),
        db.auditEvents.clear(),
        db.notifications.clear(),
        db.meta.clear(),
      ]);
      await Promise.all([
        db.queries.bulkAdd(state.queries),
        db.workflowSteps.bulkAdd(state.workflowSteps),
        db.reviews.bulkAdd(state.reviews),
        db.responseVersions.bulkAdd(state.responseVersions),
        db.auditEvents.bulkAdd(state.auditEvents),
        db.notifications.bulkAdd(state.notifications),
        db.meta.put({ key: COUNTER_KEY, value: state.counters }),
      ]);
    },
  );
}

/**
 * Persist one workflow transition atomically — the query patch, the appended
 * audit event, any new step/review/version rows, and the counter bump all land
 * together or not at all, so the audit trail can never drift from the state it
 * describes.
 */
export async function persistTransition({
  query,
  auditEvent,
  notification,
  counters,
  upsertSteps = [],
  deleteStepIds = [],
  addReviews = [],
  addVersions = [],
}) {
  return db.transaction(
    'rw',
    [db.queries, db.workflowSteps, db.reviews, db.responseVersions, db.auditEvents, db.notifications, db.meta],
    async () => {
      if (query) await db.queries.put(query);
      if (auditEvent) await db.auditEvents.add(auditEvent);
      if (notification) await db.notifications.add(notification);
      if (upsertSteps.length) await db.workflowSteps.bulkPut(upsertSteps);
      if (deleteStepIds.length) await db.workflowSteps.bulkDelete(deleteStepIds);
      if (addReviews.length) await db.reviews.bulkAdd(addReviews);
      if (addVersions.length) await db.responseVersions.bulkAdd(addVersions);
      if (counters) await db.meta.put({ key: COUNTER_KEY, value: counters });
    },
  );
}

/** True when the database has never been seeded. */
export async function isEmpty() {
  return (await db.queries.count()) === 0;
}
