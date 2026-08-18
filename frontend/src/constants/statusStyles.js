import { BUSINESS_STATUS, WORKFLOW_STATE, PRIORITY } from './statusEnums';

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

export function getStatusVariant(type, value) {
  return VARIANT_MAPS[type]?.[value] || 'status-gray';
}
