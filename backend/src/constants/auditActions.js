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

  // ── Mailbox state ────────────────────────────────────────────────────────
  EMAIL_MARKED_READ: 'EMAIL_MARKED_READ',
  EMAIL_MARKED_UNREAD: 'EMAIL_MARKED_UNREAD',
  EMAIL_MOVED: 'EMAIL_MOVED',
  EMAIL_DELETED: 'EMAIL_DELETED',

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
