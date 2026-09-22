/**
 * The workflow vocabulary, server-side.
 *
 * Mirrored deliberately from frontend/src/constants/statusEnums.js, the same
 * way constants/roles.js mirrors the frontend role list. The two must stay
 * identical — src/test/enumParity.test.js imports both and asserts it, so drift
 * fails the suite rather than surfacing later as a state the server silently
 * refuses to recognise.
 *
 * Until this file existed the backend had no state vocabulary at all: every
 * state was a bare String on the model, `pullbackController` wrote whatever
 * non-empty string the caller sent straight into `QueryCase.workflowState`, and
 * the only server-side literals were two hardcoded arrays inside
 * services/workflow/finalApproval.js.
 *
 * Enforced at the schema and authorization layers, NOT with Mongoose `enum:`.
 * A Mongoose ValidationError surfaces as a 500, and this codebase has already
 * been bitten by one being swallowed by a catch and destroying workflow events;
 * a rejection belongs where it can be a 400 or a 403 and be seen.
 */

export const BUSINESS_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
};

export const WORKFLOW_STATE = {
  RECEIVED: 'RECEIVED',
  FRONT_OFFICE_VERIFICATION: 'FRONT_OFFICE_VERIFICATION',
  PENDING_ASSIGNMENT: 'PENDING_ASSIGNMENT',
  ASSIGNED: 'ASSIGNED',
  DRAFTING: 'DRAFTING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PENDING_FINAL_APPROVAL: 'PENDING_FINAL_APPROVAL',
  APPROVED: 'APPROVED',
  READY_FOR_DISPATCH: 'READY_FOR_DISPATCH',
  DISPATCHED: 'DISPATCHED',
  CLOSED: 'CLOSED',
  RETURNED_FOR_REVISION: 'RETURNED_FOR_REVISION',
  TRANSFERRED: 'TRANSFERRED',
  PULLED_BACK: 'PULLED_BACK',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
};

export const RESPONSE_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  FINAL_APPROVED: 'FINAL_APPROVED',
};

export const PRIORITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
};

export const ALL_WORKFLOW_STATES = Object.values(WORKFLOW_STATE);
export const ALL_RESPONSE_STATUSES = Object.values(RESPONSE_STATUS);
export const ALL_BUSINESS_STATUSES = Object.values(BUSINESS_STATUS);
export const ALL_PRIORITIES = Object.values(PRIORITY);

/**
 * States a case may be approved from, and states that mean it already was.
 *
 * These two lists were hardcoded inside finalApproval.js; they live here so the
 * vocabulary has one home.
 */
export const NEEDS_APPROVAL = [WORKFLOW_STATE.PENDING_FINAL_APPROVAL, WORKFLOW_STATE.APPROVED];
export const ALREADY_APPROVED = [
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];
