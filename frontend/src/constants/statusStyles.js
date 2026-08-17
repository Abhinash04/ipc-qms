import { BUSINESS_STATUS, WORKFLOW_STATE, PRIORITY } from './statusEnums';

/**
 * Central status → Badge-variant mapping. Replaces the inline ternaries that
 * used to be duplicated across WorkflowTimeline, Header, and QueryDetailPage.
 * Values are Badge cva keys (status-green/amber/blue/indigo/purple/orange/red/gray).
 */
export const WORKFLOW_STATE_VARIANT = {
  [WORKFLOW_STATE.RECEIVED]: 'status-gray',
  [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION]: 'status-gray',
  [WORKFLOW_STATE.CLOSED]: 'status-gray',

  [WORKFLOW_STATE.PENDING_ASSIGNMENT]: 'status-amber',
  [WORKFLOW_STATE.ON_HOLD]: 'status-amber',

  [WORKFLOW_STATE.ASSIGNED]: 'status-blue',
  [WORKFLOW_STATE.DRAFTING]: 'status-blue',

  [WORKFLOW_STATE.UNDER_REVIEW]: 'status-indigo',
  [WORKFLOW_STATE.TRANSFERRED]: 'status-indigo',

  [WORKFLOW_STATE.PENDING_FINAL_APPROVAL]: 'status-purple',

  [WORKFLOW_STATE.APPROVED]: 'status-green',
  [WORKFLOW_STATE.READY_FOR_DISPATCH]: 'status-green',
  [WORKFLOW_STATE.DISPATCHED]: 'status-green',

  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: 'status-orange',
  [WORKFLOW_STATE.PULLED_BACK]: 'status-orange',

  [WORKFLOW_STATE.CANCELLED]: 'status-red',
};

export const BUSINESS_STATUS_VARIANT = {
  [BUSINESS_STATUS.OPEN]: 'status-blue',
  [BUSINESS_STATUS.IN_PROGRESS]: 'status-amber',
  [BUSINESS_STATUS.CLOSED]: 'status-gray',
};

export const PRIORITY_VARIANT = {
  [PRIORITY.LOW]: 'status-gray',
  [PRIORITY.NORMAL]: 'status-blue',
  [PRIORITY.HIGH]: 'status-orange',
  [PRIORITY.URGENT]: 'status-red',
};

/** Workflow-step status (per WorkflowStep.status, not the query-level WORKFLOW_STATE). */
export const STEP_STATUS_VARIANT = {
  COMPLETED: 'status-green',
  IN_PROGRESS: 'status-blue',
  PENDING: 'status-gray',
};

const VARIANT_MAPS = {
  workflow: WORKFLOW_STATE_VARIANT,
  business: BUSINESS_STATUS_VARIANT,
  priority: PRIORITY_VARIANT,
  step: STEP_STATUS_VARIANT,
};

/** Resolve a status value + map type to a Badge variant, falling back to neutral. */
export function getStatusVariant(type, value) {
  return VARIANT_MAPS[type]?.[value] || 'status-gray';
}
