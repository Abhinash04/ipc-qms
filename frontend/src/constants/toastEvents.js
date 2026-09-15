import { AUDIT_EVENT } from './statusEnums';

/**
 * Which committed workflow transitions surface as a toast.
 *
 * Every workflow state change goes through `applyTransition`, which always
 * appends an audit event. Subscribing to that append — rather than to a click
 * handler — is what makes a toast mean "the operation actually committed".
 *
 * The map is deliberately a *subset* of AUDIT_EVENT. An event missing here is
 * still recorded in the audit trail and still visible in the Admin activity
 * console; it just does not interrupt the user. The omissions are listed at the
 * bottom with the reason each one is silent, so this stays a decision rather
 * than an oversight.
 */
export const TOAST_EVENTS = {
  [AUDIT_EVENT.QUERY_RECEIVED]: {
    type: 'success',
    title: 'Enquiry raised',
  },
  [AUDIT_EVENT.ACKNOWLEDGEMENT_SENT]: {
    type: 'success',
    title: 'Acknowledgement sent to the inquirer',
  },
  [AUDIT_EVENT.QUERY_FORWARDED]: {
    type: 'success',
    title: 'Forwarded to the Officer-in-Charge',
  },
  [AUDIT_EVENT.QUERY_ASSIGNED]: {
    type: 'success',
    title: 'Query assigned',
  },
  [AUDIT_EVENT.DRAFT_GENERATED]: {
    type: 'success',
    title: 'Draft response generated',
  },
  [AUDIT_EVENT.REVIEW_COMPLETED]: {
    type: 'success',
    title: 'Review approved',
  },
  [AUDIT_EVENT.REVISION_REQUESTED]: {
    type: 'warning',
    title: 'Changes requested',
  },
  [AUDIT_EVENT.FINAL_APPROVAL_GRANTED]: {
    type: 'success',
    title: 'Final approval granted',
  },
  [AUDIT_EVENT.FINAL_APPROVAL_REJECTED]: {
    type: 'warning',
    title: 'Final approval rejected',
  },
  [AUDIT_EVENT.RESPONSE_DISPATCHED]: {
    type: 'success',
    title: 'Response sent to the inquirer',
  },
  [AUDIT_EVENT.QUERY_CLOSED]: {
    type: 'info',
    title: 'Query closed',
  },
};

/**
 * Deliberately silent — recorded in the audit trail, never toasted:
 *
 * - AI_SUMMARY_GENERATED    fires twice for one case (local summary, then the
 *                           Gemma summary replacing it), so it is pure noise.
 * - DRAFT_UPDATED           fires on every save of the draft editor.
 * - REVIEW_ADDED            is also emitted when a review is *deleted*, so its
 *                           label cannot be trusted as a user-facing message.
 * - QUERY_REGISTERED        is the same moment as QUERY_RECEIVED for the user.
 * - AI_ASSIGNMENT_RECOMMENDED, ASSIGNMENT_OVERRIDDEN
 *                           internal detail alongside QUERY_ASSIGNED.
 * - QUERY_TRANSFERRED, QUERY_PULLED_BACK
 *                           belong to actions CLARIFICATION_REQUIRED_ACTIONS
 *                           currently disables.
 */
export const SILENT_EVENTS = [
  AUDIT_EVENT.AI_SUMMARY_GENERATED,
  AUDIT_EVENT.DRAFT_UPDATED,
  AUDIT_EVENT.REVIEW_ADDED,
  AUDIT_EVENT.QUERY_REGISTERED,
  AUDIT_EVENT.AI_ASSIGNMENT_RECOMMENDED,
  AUDIT_EVENT.ASSIGNMENT_OVERRIDDEN,
  AUDIT_EVENT.QUERY_TRANSFERRED,
  AUDIT_EVENT.QUERY_PULLED_BACK,
];
