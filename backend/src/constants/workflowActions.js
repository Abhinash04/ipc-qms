import { ROLES } from './roles.js';

/**
 * Role → action authorization, ported from
 * frontend/src/constants/workflowRules.js — keep the two in sync.
 *
 * NOTE ON SCOPE: the frontend's `canPerform(role, action, workflowState)` has
 * two halves. Only the first — which roles may ever perform an action — can be
 * enforced here, because the server does not yet own workflow state (all Query
 * Case state lives in the browser's IndexedDB until Phase 2). The second half,
 * ACTION_VALID_STATES, is therefore NOT implemented server-side.
 *
 * Concretely: the server can refuse a REVIEWER attempting FORWARD, but it
 * cannot yet refuse a FRONT_OFFICE forwarding a query that is in the wrong
 * state. Do not read `roleCanPerform` as full parity with `canPerform`.
 *
 * TODO(phase-2): once cases are persisted server-side, add the state check and
 * make this the single authority.
 */
export const WORKFLOW_ACTION = {
  VERIFY: 'VERIFY',
  FORWARD: 'FORWARD',
  ASSIGN: 'ASSIGN',
  GENERATE_AI_DRAFT: 'GENERATE_AI_DRAFT',
  SAVE_DRAFT: 'SAVE_DRAFT',
  SUBMIT_FOR_REVIEW: 'SUBMIT_FOR_REVIEW',
  APPROVE_REVIEW: 'APPROVE_REVIEW',
  REQUEST_REVISION: 'REQUEST_REVISION',
  ADD_REVIEW_LEVEL: 'ADD_REVIEW_LEVEL',
  DELETE_REVIEW_LEVEL: 'DELETE_REVIEW_LEVEL',
  FINAL_APPROVE: 'FINAL_APPROVE',
  FINAL_REJECT: 'FINAL_REJECT',
  RETURN_FOR_REVISION: 'RETURN_FOR_REVISION',
  DISPATCH: 'DISPATCH',
  TRANSFER: 'TRANSFER',
  PULLBACK: 'PULLBACK',
};

export const CLARIFICATION_REQUIRED_ACTIONS = [
  WORKFLOW_ACTION.DELETE_REVIEW_LEVEL,
];

export const ROLE_ACTIONS = {
  [ROLES.FRONT_OFFICE]: [WORKFLOW_ACTION.VERIFY, WORKFLOW_ACTION.FORWARD, WORKFLOW_ACTION.DISPATCH],
  [ROLES.OFFICER_IN_CHARGE]: [
    WORKFLOW_ACTION.ASSIGN,
    WORKFLOW_ACTION.FINAL_APPROVE,
    WORKFLOW_ACTION.FINAL_REJECT,
    WORKFLOW_ACTION.RETURN_FOR_REVISION,
  ],
  [ROLES.ASSIGNED_OFFICIAL]: [
    WORKFLOW_ACTION.GENERATE_AI_DRAFT,
    WORKFLOW_ACTION.SAVE_DRAFT,
    WORKFLOW_ACTION.SUBMIT_FOR_REVIEW,
    WORKFLOW_ACTION.ADD_REVIEW_LEVEL,
    WORKFLOW_ACTION.TRANSFER,
  ],
  [ROLES.REVIEWER]: [WORKFLOW_ACTION.APPROVE_REVIEW, WORKFLOW_ACTION.REQUEST_REVISION],
  [ROLES.ADMIN]: [WORKFLOW_ACTION.PULLBACK],
  [ROLES.INQUIRER]: [],
  [ROLES.SUPER_ADMIN]: [
    WORKFLOW_ACTION.VERIFY,
    WORKFLOW_ACTION.FORWARD,
    WORKFLOW_ACTION.ASSIGN,
    WORKFLOW_ACTION.GENERATE_AI_DRAFT,
    WORKFLOW_ACTION.SAVE_DRAFT,
    WORKFLOW_ACTION.SUBMIT_FOR_REVIEW,
    WORKFLOW_ACTION.APPROVE_REVIEW,
    WORKFLOW_ACTION.REQUEST_REVISION,
    WORKFLOW_ACTION.ADD_REVIEW_LEVEL,
    WORKFLOW_ACTION.FINAL_APPROVE,
    WORKFLOW_ACTION.FINAL_REJECT,
    WORKFLOW_ACTION.RETURN_FOR_REVISION,
    WORKFLOW_ACTION.DISPATCH,
    WORKFLOW_ACTION.TRANSFER,
    WORKFLOW_ACTION.PULLBACK,
  ],
};

/** The role half of the frontend's `canPerform`. See the scope note above. */
export function roleCanPerform(role, action) {
  if (CLARIFICATION_REQUIRED_ACTIONS.includes(action)) return false;
  return (ROLE_ACTIONS[role] || []).includes(action);
}
