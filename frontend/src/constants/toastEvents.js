import { AUDIT_EVENT } from './statusEnums';

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
