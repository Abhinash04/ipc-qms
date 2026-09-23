/**
 * Audit action names.
 *
 * Frozen strings, because they are written into persisted records: renaming
 * one silently orphans every event already stored under the old name.
 */
export const AUDIT_ACTIONS = {
  // ── Authentication ───────────────────────────────────────────────────────
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',

  // ── Mail intake ──────────────────────────────────────────────────────────
  EMAIL_RECEIVED: 'EMAIL_RECEIVED',
  EMAIL_READ: 'EMAIL_READ',
  EMAIL_CLASSIFIED: 'EMAIL_CLASSIFIED',
  ATTACHMENT_UPLOADED: 'ATTACHMENT_UPLOADED',
  ATTACHMENT_DOWNLOADED: 'ATTACHMENT_DOWNLOADED',

  // ── Case ─────────────────────────────────────────────────────────────────
  CASE_CREATED: 'CASE_CREATED',
  CASE_ASSOCIATED: 'CASE_ASSOCIATED',
  CASE_ASSOCIATION_CHANGED: 'CASE_ASSOCIATION_CHANGED',

  // ── AI ───────────────────────────────────────────────────────────────────
  AI_SUMMARY_GENERATED: 'AI_SUMMARY_GENERATED',
  AI_DRAFT_GENERATED: 'AI_DRAFT_GENERATED',
  AI_RECOMMENDATION_GENERATED: 'AI_RECOMMENDATION_GENERATED',

  // ── Approval ─────────────────────────────────────────────────────────────
  DRAFT_CREATED: 'DRAFT_CREATED',
  DRAFT_EDITED: 'DRAFT_EDITED',
  DRAFT_SUBMITTED_FOR_APPROVAL: 'DRAFT_SUBMITTED_FOR_APPROVAL',
  DRAFT_APPROVED: 'DRAFT_APPROVED',
  DRAFT_REJECTED: 'DRAFT_REJECTED',

  // ── Outbound ─────────────────────────────────────────────────────────────
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_REPLIED: 'EMAIL_REPLIED',
  EMAIL_FORWARDED: 'EMAIL_FORWARDED',
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
  SENT_APPEND_FAILED: 'SENT_APPEND_FAILED',
  /** A person settled a send whose outcome the server could not determine. */
  EMAIL_DELIVERY_CONFIRMED: 'EMAIL_DELIVERY_CONFIRMED',
  EMAIL_DELIVERY_DENIED: 'EMAIL_DELIVERY_DENIED',

  // ── Mailbox state ────────────────────────────────────────────────────────
  EMAIL_MARKED_READ: 'EMAIL_MARKED_READ',
  EMAIL_MARKED_UNREAD: 'EMAIL_MARKED_UNREAD',
  EMAIL_MOVED: 'EMAIL_MOVED',
  EMAIL_DELETED: 'EMAIL_DELETED',
  /**
   * The retention sweep stripped a junk message's content. Not a delete: the id
   * stub remains, because it is what stops the next sync re-ingesting the
   * message. Deliberately absent from CLIENT_AUDIT_EVENTS — no client writes it.
   */
  EMAIL_PURGED: 'EMAIL_PURGED',

  // ── Synchronisation ──────────────────────────────────────────────────────
  SYNC_STARTED: 'SYNC_STARTED',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
  SYNC_FAILED: 'SYNC_FAILED',
  SYNC_RECOVERED: 'SYNC_RECOVERED',
  UIDVALIDITY_CHANGED: 'UIDVALIDITY_CHANGED',
  CREDENTIAL_ROTATED: 'CREDENTIAL_ROTATED',
};

export const AUDIT_RESULTS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  DENIED: 'denied',
};

export const ALL_AUDIT_ACTIONS = Object.values(AUDIT_ACTIONS);

/**
 * The workflow event names the CLIENT writes, mirrored from
 * frontend/src/constants/statusEnums.js (`AUDIT_EVENT`).
 *
 * These are a separate vocabulary from AUDIT_ACTIONS above, which the server
 * writes for itself. Eighteen of the nineteen appear in no server-side list at
 * all, so a bare `z.enum(ALL_AUDIT_ACTIONS)` on the persist route would reject
 * nearly every audit row the application produces — which is why the two are
 * unioned rather than merged.
 *
 * src/test/enumParity.test.js asserts this stays identical to the client list.
 */
export const CLIENT_AUDIT_EVENTS = [
  'QUERY_RECEIVED',
  'ACKNOWLEDGEMENT_SENT',
  'AI_SUMMARY_GENERATED',
  'AI_ASSIGNMENT_RECOMMENDED',
  'QUERY_REGISTERED',
  'QUERY_FORWARDED',
  'QUERY_ASSIGNED',
  'ASSIGNMENT_OVERRIDDEN',
  'DRAFT_GENERATED',
  'DRAFT_UPDATED',
  'REVIEW_ADDED',
  'REVIEW_COMPLETED',
  'REVISION_REQUESTED',
  'QUERY_TRANSFERRED',
  'QUERY_PULLED_BACK',
  'FINAL_APPROVAL_GRANTED',
  'FINAL_APPROVAL_REJECTED',
  'RESPONSE_DISPATCHED',
  'QUERY_CLOSED',
];

const KNOWN_EVENTS = new Set([...ALL_AUDIT_ACTIONS, ...CLIENT_AUDIT_EVENTS]);

/**
 * Is this a name the audit trail recognises?
 *
 * The trail used to take whatever string the caller sent, so any signed-in
 * account could append rows under invented names — and, with a client-supplied
 * timestamp, place them at the head of the administrator's first page. Bounding
 * the vocabulary does not make the trail unforgeable (a legitimate name is
 * still a legitimate name), but it keeps it a closed set, which is what makes
 * it readable as a record.
 */
export const isKnownAuditAction = (action) => KNOWN_EVENTS.has(action);
