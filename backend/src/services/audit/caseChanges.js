/**
 * The previous and new values an audit event records when it changes a case. Stored as codes
 * and IDs (exactly what the case holds); auditPresentation.js words them for reports.
 */
export const TRACKED_CASE_FIELDS = {
  workflowState: 'status',
  currentAssigneeId: 'assignee',
  category: 'category',
  priority: 'priority',
};

/** The tracked fields whose value differs between `before` (or no case) and `after`. */
export function diffCase(before, after) {
  if (!after) return null;
  const changes = {};
  for (const [field, name] of Object.entries(TRACKED_CASE_FIELDS)) {
    if (!(field in after)) continue;
    const from = before?.[field] ?? null;
    const to = after[field] ?? null;
    if (from !== to) changes[name] = { from, to };
  }
  return Object.keys(changes).length ? changes : null;
}

// The status each workflow step leaves a query in (the browser's and the server's transitions).
const STATUS_AFTER = {
  QUERY_RECEIVED: 'RECEIVED',
  CASE_CREATED: 'RECEIVED',
  QUERY_REGISTERED: 'FRONT_OFFICE_VERIFICATION',
  QUERY_FORWARDED: 'PENDING_ASSIGNMENT',
  QUERY_ASSIGNED: 'ASSIGNED',
  DRAFT_GENERATED: 'DRAFTING',
  REVISION_REQUESTED: 'RETURNED_FOR_REVISION',
  FINAL_APPROVAL_REJECTED: 'RETURNED_FOR_REVISION',
  FINAL_APPROVAL_GRANTED: 'READY_FOR_DISPATCH',
  RESPONSE_DISPATCHED: 'DISPATCHED',
  QUERY_CLOSED: 'CLOSED',
  AUTO_REPLY_APPROVED: 'READY_FOR_DISPATCH',
  AUTO_REPLY_PREPARED: 'READY_FOR_DISPATCH',
};

const keyOf = (event) =>
  typeof event.seq === 'number' ? `seq:${event.seq}` : `${event.timestamp}|${event.action}|${event.queryId}|${event.auditId ?? ''}`;

function statusAfter(event, later) {
  if (STATUS_AFTER[event.action]) return STATUS_AFTER[event.action];
  if (event.action === 'QUERY_PULLED_BACK') return event.details?.targetStage || null;
  if (event.action === 'DRAFT_UPDATED') {
    return /submitted for review/i.test(typeof event.details === 'string' ? event.details : '') ? 'UNDER_REVIEW' : 'DRAFTING';
  }
  if (event.action === 'REVIEW_COMPLETED') {
    // Another review approval before the final decision means more review levels were left.
    const next = later.find((e) => e.action === 'REVIEW_COMPLETED' || e.action.startsWith('FINAL_APPROVAL_'));
    return next?.action === 'REVIEW_COMPLETED' ? 'UNDER_REVIEW' : 'PENDING_FINAL_APPROVAL';
  }
  return null;
}

/**
 * Works out the previous and new values of events recorded without them (before they were
 * captured), from each query's own sequence of recorded steps: the status a step leaves the
 * query in, against the status the step before left it in.
 * `history` is every event of the queries concerned. Returns a Map from event key to changes.
 */
export function inferCaseChanges(history) {
  const byCase = new Map();
  for (const event of history) {
    if (!event.queryId) continue;
    if (!byCase.has(event.queryId)) byCase.set(event.queryId, []);
    byCase.get(event.queryId).push(event);
  }

  const inferred = new Map();
  for (const events of byCase.values()) {
    events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || (a.seq ?? 0) - (b.seq ?? 0));
    let status = null;
    events.forEach((event, index) => {
      if (event.changes?.status) status = event.changes.status.to ?? status;
      if (event.changes) return;

      const changes = {};
      const next = statusAfter(event, events.slice(index + 1));
      if (next && next !== status) {
        changes.status = { from: status, to: next };
        status = next;
      }
      if (Object.keys(changes).length) inferred.set(keyOf(event), changes);
    });
  }
  return inferred;
}

export { keyOf as changeKeyOf };

/** One change, for code paths that set a single field themselves. */
export const change = (name, from, to) => (from === to ? null : { [name]: { from: from ?? null, to: to ?? null } });
