import { WORKFLOW_STATE } from './statusEnums';

export const PREDEFINED_PULLBACK_REASONS = [
  'Incorrect assignment',
  'Incorrect information',
  'Requires correction',
  'Requires additional review',
  'Sent to wrong department',
  'Response requires modification',
  'Administrative intervention',
  'Query needs to be reassigned',
  'Other',
];

export const STAGE_LABELS = {
  [WORKFLOW_STATE.RECEIVED]: 'IPC Mailbox / Intake',
  [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION]: 'Front Officer Validation / Registration',
  [WORKFLOW_STATE.PENDING_ASSIGNMENT]: 'Forwarded to Officer-in-Charge',
  [WORKFLOW_STATE.ASSIGNED]: 'Assigned to Official',
  [WORKFLOW_STATE.DRAFTING]: 'Drafting Response',
  [WORKFLOW_STATE.UNDER_REVIEW]: 'Review / Action',
  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: 'Returned for Revision',
  [WORKFLOW_STATE.PENDING_FINAL_APPROVAL]: 'Pending Final Approval',
  [WORKFLOW_STATE.READY_FOR_DISPATCH]: 'Ready for Dispatch',
  [WORKFLOW_STATE.DISPATCHED]: 'Dispatched',
  [WORKFLOW_STATE.CLOSED]: 'Query Closure',
};

const STAGE_ORDER = [
  WORKFLOW_STATE.RECEIVED,
  WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
  WORKFLOW_STATE.PENDING_ASSIGNMENT,
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.UNDER_REVIEW,
  WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.CLOSED,
];

export function getValidPullbackStages(query, auditEvents = []) {
  if (!query) return [];

  const queryAudits = auditEvents.filter((a) => a.queryId === query.queryId);
  const reachedStates = new Set();

  reachedStates.add(WORKFLOW_STATE.RECEIVED);

  queryAudits.forEach((audit) => {
    const evt = audit.event;
    if (evt === 'QUERY_RECEIVED') reachedStates.add(WORKFLOW_STATE.RECEIVED);
    if (evt === 'QUERY_REGISTERED') reachedStates.add(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    if (evt === 'QUERY_FORWARDED') reachedStates.add(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    if (evt === 'QUERY_ASSIGNED' || evt === 'QUERY_TRANSFERRED') reachedStates.add(WORKFLOW_STATE.ASSIGNED);
    if (evt === 'DRAFT_GENERATED' || evt === 'DRAFT_UPDATED') reachedStates.add(WORKFLOW_STATE.DRAFTING);
    if (evt === 'REVIEW_ADDED' || evt === 'REVIEW_COMPLETED') reachedStates.add(WORKFLOW_STATE.UNDER_REVIEW);
    if (evt === 'REVISION_REQUESTED' || evt === 'FINAL_APPROVAL_REJECTED') reachedStates.add(WORKFLOW_STATE.RETURNED_FOR_REVISION);
    if (evt === 'FINAL_APPROVAL_GRANTED') reachedStates.add(WORKFLOW_STATE.READY_FOR_DISPATCH);
    if (evt === 'RESPONSE_DISPATCHED') reachedStates.add(WORKFLOW_STATE.DISPATCHED);
    if (evt === 'QUERY_CLOSED') reachedStates.add(WORKFLOW_STATE.CLOSED);
  });

  const currentIdx = STAGE_ORDER.indexOf(query.workflowState);
  if (currentIdx > 0) {
    for (let i = 0; i < currentIdx; i++) {
      reachedStates.add(STAGE_ORDER[i]);
    }
  }

  reachedStates.delete(query.workflowState);

  return Array.from(reachedStates).sort((a, b) => {
    const idxA = STAGE_ORDER.indexOf(a);
    const idxB = STAGE_ORDER.indexOf(b);
    return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
  });
}
