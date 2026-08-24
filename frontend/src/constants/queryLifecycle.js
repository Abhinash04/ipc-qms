import { AUDIT_EVENT, WORKFLOW_STATE } from './statusEnums';
import { EMAIL_TYPE } from './emailModel';
import { findUserById } from './mockUsers';

export const LEVEL_NAMES = ['Reviewer I', 'Reviewer II', 'Reviewer III'];

export const reviewLevelName = (index) => LEVEL_NAMES[index] || `Reviewer ${index + 1}`;

export const STAGE_STATUS = {
  COMPLETE: 'COMPLETE',
  CURRENT: 'CURRENT',
  PENDING: 'PENDING',
};

export const STAGE = {
  SUBMITTED: 'SUBMITTED',
  VERIFIED: 'VERIFIED',
  FORWARDED: 'FORWARDED',
  ASSIGNED: 'ASSIGNED',
  DRAFTED: 'DRAFTED',
  REVIEW: 'REVIEW',
  FINAL_APPROVAL: 'FINAL_APPROVAL',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
};

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function buildLifecycle({
  query,
  steps = [],
  versions = [],
  reviews = [],
  audit = [],
  messages = [],
} = {}) {
  if (!query) return [];

  const seen = new Set(audit.map((a) => a.event));
  const at = (event) => audit.find((a) => a.event === event)?.at || null;
  const emailAt = (emailType) =>
    messages.find((m) => m.emailType === emailType)?.timestamp || null;

  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const finalStep = steps.find((s) => s.stepType === 'FINAL_APPROVAL');
  const wasReturned = query.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION;
  const latestReturn = [...reviews].reverse().find((r) => r.decision === 'CHANGES_REQUESTED');

  const draftLabel = versions.length
    ? `Response drafted (v${versions.length})`
    : 'Response drafted';

  const returnNote =
    wasReturned && latestReturn
      ? `Returned for revision — ${findUserById(latestReturn.reviewerId)?.name || 'a reviewer'} requested changes`
      : null;

  const raw = [
    {
      key: STAGE.SUBMITTED,
      label: 'Enquiry submitted',
      actor: query.inquirer?.name || null,
      complete: true,
      at: at(AUDIT_EVENT.QUERY_RECEIVED) || query.createdAt,
    },
    {
      key: STAGE.VERIFIED,
      label: 'Verified & acknowledged',
      actor: 'Front Office',
      complete: seen.has(AUDIT_EVENT.QUERY_REGISTERED),
      at: at(AUDIT_EVENT.QUERY_REGISTERED) || emailAt(EMAIL_TYPE.ACKNOWLEDGEMENT),
    },
    {
      key: STAGE.FORWARDED,
      label: 'Forwarded to Officer-in-Charge',
      actor: 'Front Office',
      complete: seen.has(AUDIT_EVENT.QUERY_FORWARDED),
      at: at(AUDIT_EVENT.QUERY_FORWARDED),
    },
    {
      key: STAGE.ASSIGNED,
      label: 'Assigned to an official',
      actor: findUserById(query.currentAssigneeId)?.name || null,
      complete: seen.has(AUDIT_EVENT.QUERY_ASSIGNED),
      at: at(AUDIT_EVENT.QUERY_ASSIGNED),
    },
    {
      key: STAGE.DRAFTED,
      label: draftLabel,
      actor: findUserById(query.currentAssigneeId)?.name || null,
      complete: versions.length > 0 && !DRAFTING_STATES.includes(query.workflowState),
      at: at(AUDIT_EVENT.DRAFT_GENERATED),
      note: returnNote,
    },
  ];

  if (reviewSteps.length === 0) {
    raw.push({
      key: `${STAGE.REVIEW}-0`,
      label: 'Review',
      actor: null,
      complete: false,
    });
  } else {
    reviewSteps.forEach((step, index) => {
      raw.push({
        key: `${STAGE.REVIEW}-${step.stepId}`,
        label: reviewLevelName(index),
        actor: findUserById(step.assignedUserId)?.name || null,
        complete: step.status === 'COMPLETED',
        at: step.completedAt,
      });
    });
  }

  raw.push(
    {
      key: STAGE.FINAL_APPROVAL,
      label: 'Final approval',
      actor: findUserById(finalStep?.assignedUserId)?.name || 'Officer-in-Charge',
      complete: seen.has(AUDIT_EVENT.FINAL_APPROVAL_GRANTED),
      at: at(AUDIT_EVENT.FINAL_APPROVAL_GRANTED),
    },
    {
      key: STAGE.DISPATCHED,
      label: 'Response dispatched',
      actor: 'Front Office',
      complete: seen.has(AUDIT_EVENT.RESPONSE_DISPATCHED),
      at: at(AUDIT_EVENT.RESPONSE_DISPATCHED),
    },
    {
      key: STAGE.DELIVERED,
      label: 'Inquirer received response',
      actor: query.inquirer?.name || null,
      complete: Boolean(emailAt(EMAIL_TYPE.OUTGOING_RESPONSE)),
      at: emailAt(EMAIL_TYPE.OUTGOING_RESPONSE),
    },
  );

  const currentIndex = raw.findIndex((stage) => !stage.complete);

  return raw.map((stage, index) => {
    const { complete, ...rest } = stage;
    return {
      ...rest,
      status: complete
        ? STAGE_STATUS.COMPLETE
        : index === currentIndex
          ? STAGE_STATUS.CURRENT
          : STAGE_STATUS.PENDING,
    };
  });
}
