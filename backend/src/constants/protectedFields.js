import { WORKFLOW_ACTION } from './workflowActions.js';
import { WORKFLOW_STATE, RESPONSE_STATUS } from './workflowStates.js';

/**
 * Which submitted VALUES require which workflow action.
 *
 * `POST /queries/persist` takes a whole case document, so there is no "action"
 * on the wire to gate on — the client computed the transition and sent the
 * result. What the server can do is read the *destination* out of the delta and
 * ask whether this role may cause it.
 *
 * Gating on the value rather than the field is what gives the check teeth.
 * "`workflowState` requires one of thirteen actions" is barely a constraint;
 * "`workflowState: 'ASSIGNED'` requires ASSIGN" denies an INQUIRER outright.
 *
 * Checked with the existing roleCanPerform() from constants/workflowActions.js,
 * so this introduces no second authorization vocabulary to keep in step.
 */

const { VERIFY, FORWARD, ASSIGN, GENERATE_AI_DRAFT, SAVE_DRAFT, SUBMIT_FOR_REVIEW, APPROVE_REVIEW,
  REQUEST_REVISION, FINAL_APPROVE, RETURN_FOR_REVISION, DISPATCH, TRANSFER, PULLBACK } = WORKFLOW_ACTION;

/**
 * `null` means no workflow action grants this state: it is reached only at
 * intake or by an operational override, both of which are the province of the
 * roles that already see every case.
 */
export const STATE_REQUIRES_ACTION = {
  [WORKFLOW_STATE.RECEIVED]: null,
  [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION]: [VERIFY],
  [WORKFLOW_STATE.PENDING_ASSIGNMENT]: [FORWARD],
  [WORKFLOW_STATE.ASSIGNED]: [ASSIGN],
  [WORKFLOW_STATE.DRAFTING]: [SAVE_DRAFT, GENERATE_AI_DRAFT],
  // Submitting opens the first review level, and a reviewer approving one level
  // of several moves the case to the NEXT one — so approval lands here too.
  [WORKFLOW_STATE.UNDER_REVIEW]: [SUBMIT_FOR_REVIEW, APPROVE_REVIEW],
  // A reviewer approving the last level moves the case here, and so does an
  // official submitting when no review level is open.
  [WORKFLOW_STATE.PENDING_FINAL_APPROVAL]: [APPROVE_REVIEW, SUBMIT_FOR_REVIEW],
  [WORKFLOW_STATE.APPROVED]: [FINAL_APPROVE],
  [WORKFLOW_STATE.READY_FOR_DISPATCH]: [FINAL_APPROVE],
  [WORKFLOW_STATE.DISPATCHED]: [DISPATCH],
  // Closing follows a dispatch, and final approval closes a case it dispatched
  // itself.
  [WORKFLOW_STATE.CLOSED]: [DISPATCH, FINAL_APPROVE],
  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: [REQUEST_REVISION, RETURN_FOR_REVISION],
  [WORKFLOW_STATE.TRANSFERRED]: [TRANSFER],
  [WORKFLOW_STATE.PULLED_BACK]: [PULLBACK],
  [WORKFLOW_STATE.ON_HOLD]: null,
  [WORKFLOW_STATE.CANCELLED]: null,
};

/**
 * The final-approval lock.
 *
 * models/ResponseVersion.js calls `status` "the final-approval lock, not a
 * label", and the client enforced it in the browser store. Approval is granted
 * server-side by POST /queries/:queryId/final-approval, which is already gated
 * on FINAL_APPROVE; the client never writes FINAL_APPROVED itself. This rule
 * therefore costs nothing legitimate and closes the persist route as a second,
 * ungated way to set the same lock.
 */
export const VERSION_STATUS_REQUIRES_ACTION = {
  [RESPONSE_STATUS.DRAFT]: null,
  [RESPONSE_STATUS.SUBMITTED]: [SUBMIT_FOR_REVIEW, SAVE_DRAFT],
  [RESPONSE_STATUS.FINAL_APPROVED]: [FINAL_APPROVE],
};

/**
 * Naming the assignee is how a principal would write themselves into a case's
 * membership, so this is the direct anti-self-promotion rule.
 *
 * Every legitimate writer holds one of these: assignment (OIC), transfer (the
 * assigned official), and pullback (ADMIN), which re-points or clears it.
 * Clearing to null is exempt — intake creates a case with no assignee.
 */
export const ASSIGNEE_REQUIRES_ACTION = [ASSIGN, TRANSFER, PULLBACK];
