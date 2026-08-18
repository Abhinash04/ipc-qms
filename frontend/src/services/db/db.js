import Dexie from 'dexie';

export const db = new Dexie('qms');

db.version(1).stores({
  queries: '&queryId, workflowState, businessStatus, priority, currentAssigneeId, currentWorkflowStepId, updatedAt',
  workflowSteps: '&stepId, queryId, stepType, status, assignedUserId, sequence, [queryId+sequence]',
  reviews: '&reviewId, queryId, stepId, reviewerId, decision, at',
  responseVersions: '&responseId, queryId, version, createdAt',
  auditEvents: '&auditId, queryId, event, actor, at',
  notifications: '&notificationId, queryId, recipientRole, at',
  meta: '&key',
});

db.version(2).stores({
  emailMessages: '&messageId, threadId, queryId, direction, emailType, timestamp',
  emailThreads: '&threadId, queryId, createdAt',
});

export const COUNTER_KEY = 'counters';

const ALL_TABLES = () => [
  db.queries,
  db.workflowSteps,
  db.reviews,
  db.responseVersions,
  db.auditEvents,
  db.notifications,
  db.emailMessages,
  db.emailThreads,
  db.meta,
];

export async function loadAll() {
  return db.transaction('r', ALL_TABLES(), async () => ({
    queries: await db.queries.toArray(),
    workflowSteps: await db.workflowSteps.toArray(),
    reviews: await db.reviews.toArray(),
    responseVersions: await db.responseVersions.toArray(),
    auditEvents: await db.auditEvents.toArray(),
    notifications: await db.notifications.toArray(),
    emailMessages: await db.emailMessages.toArray(),
    emailThreads: await db.emailThreads.toArray(),
    counters: (await db.meta.get(COUNTER_KEY))?.value ?? null,
  }));
}

export async function replaceAll(state) {
  return db.transaction('rw', ALL_TABLES(), async () => {
    await Promise.all([
      db.queries.clear(),
      db.workflowSteps.clear(),
      db.reviews.clear(),
      db.responseVersions.clear(),
      db.auditEvents.clear(),
      db.notifications.clear(),
      db.emailMessages.clear(),
      db.emailThreads.clear(),
      db.meta.clear(),
    ]);
    await Promise.all([
      db.queries.bulkAdd(state.queries),
      db.workflowSteps.bulkAdd(state.workflowSteps),
      db.reviews.bulkAdd(state.reviews),
      db.responseVersions.bulkAdd(state.responseVersions),
      db.auditEvents.bulkAdd(state.auditEvents),
      db.notifications.bulkAdd(state.notifications),
      db.emailMessages.bulkAdd(state.emailMessages || []),
      db.emailThreads.bulkAdd(state.emailThreads || []),
      db.meta.put({ key: COUNTER_KEY, value: state.counters }),
    ]);
  });
}
export async function persistTransition({
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
}) {
  return db.transaction('rw', ALL_TABLES(), async () => {
    if (query) await db.queries.put(query);
    if (auditEvent) await db.auditEvents.add(auditEvent);
    if (notification) await db.notifications.add(notification);
    if (upsertSteps.length) await db.workflowSteps.bulkPut(upsertSteps);
    if (deleteStepIds.length) await db.workflowSteps.bulkDelete(deleteStepIds);
    if (addReviews.length) await db.reviews.bulkAdd(addReviews);
    if (addVersions.length) await db.responseVersions.bulkAdd(addVersions);
    if (upsertVersions.length) await db.responseVersions.bulkPut(upsertVersions);
    if (addThreads.length) await db.emailThreads.bulkAdd(addThreads);
    if (addMessages.length) await db.emailMessages.bulkAdd(addMessages);
    if (counters) await db.meta.put({ key: COUNTER_KEY, value: counters });
  });
}

export async function isEmpty() {
  return (await db.queries.count()) === 0;
}
