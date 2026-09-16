import { AUDIT_EVENT, WORKFLOW_STATE } from './statusEnums';
import { EMAIL_TYPE } from './emailModel';
import { findUserById } from './mockUsers';
import { STAGE_LABELS } from './pullbackRules';

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

  const at = (event) => audit.find((a) => a.event === event)?.at || null;
  const emailAt = (emailType) =>
    messages.find((m) => m.emailType === emailType)?.timestamp || null;

  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const finalStep = steps.find((s) => s.stepType === 'FINAL_APPROVAL');
  const wasReturned = query.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION;
  const latestReturn = [...reviews].reverse().find((r) => r.decision === 'CHANGES_REQUESTED');

  const latestPullback = query.pullbackHistory?.length
    ? query.pullbackHistory[query.pullbackHistory.length - 1]
    : null;

  const draftLabel = versions.length
    ? `Response drafted (v${versions.length})`
    : 'Response drafted';

  let returnNote =
    wasReturned && latestReturn
      ? `Returned for revision — ${findUserById(latestReturn.reviewerId)?.name || 'a reviewer'} requested changes`
      : null;

  if (latestPullback) {
    const fromStageName = STAGE_LABELS[latestPullback.fromStage] || latestPullback.fromStage;
    returnNote = `↩ Pulled back from ${fromStageName} by ${latestPullback.pulledBackByName} (${latestPullback.reason})`;
  }

  const raw = [
    {
      key: STAGE.SUBMITTED,
      label: 'Enquiry submitted',
      actor: query.inquirer?.name || null,
      at: at(AUDIT_EVENT.QUERY_RECEIVED) || query.createdAt,
    },
    {
      key: STAGE.VERIFIED,
      label: 'Verified & acknowledged',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.QUERY_REGISTERED) || emailAt(EMAIL_TYPE.ACKNOWLEDGEMENT),
    },
    {
      key: STAGE.FORWARDED,
      label: 'Forwarded to Officer-in-Charge',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.QUERY_FORWARDED),
    },
    {
      key: STAGE.ASSIGNED,
      label: 'Assigned to an official',
      actor: findUserById(query.currentAssigneeId)?.name || null,
      at: at(AUDIT_EVENT.QUERY_ASSIGNED),
    },
    {
      key: STAGE.DRAFTED,
      label: draftLabel,
      actor: findUserById(query.currentAssigneeId)?.name || null,
      at: at(AUDIT_EVENT.DRAFT_GENERATED),
      note: returnNote,
    },
  ];

  if (reviewSteps.length === 0) {
    raw.push({
      key: `${STAGE.REVIEW}-0`,
      label: 'Review',
      actor: null,
    });
  } else {
    reviewSteps.forEach((step, index) => {
      raw.push({
        key: `${STAGE.REVIEW}-${step.stepId}`,
        label: reviewLevelName(index),
        actor: findUserById(step.assignedUserId)?.name || null,
        at: step.completedAt,
      });
    });
  }

  raw.push(
    {
      key: STAGE.FINAL_APPROVAL,
      label: 'Final approval',
      actor: findUserById(finalStep?.assignedUserId)?.name || 'Officer-in-Charge',
      at: at(AUDIT_EVENT.FINAL_APPROVAL_GRANTED),
    },
    {
      key: STAGE.DISPATCHED,
      label: 'Response dispatched',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.RESPONSE_DISPATCHED),
    },
    {
      key: STAGE.DELIVERED,
      label: 'Inquirer received response',
      actor: query.inquirer?.name || null,
      at: emailAt(EMAIL_TYPE.OUTGOING_RESPONSE),
    },
  );

  let targetKey = STAGE.VERIFIED;
  const state = query.workflowState;

  if (state === WORKFLOW_STATE.RECEIVED) {
    targetKey = STAGE.VERIFIED;
  } else if (state === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION) {
    targetKey = STAGE.FORWARDED;
  } else if (state === WORKFLOW_STATE.PENDING_ASSIGNMENT) {
    targetKey = STAGE.ASSIGNED;
  } else if (state === WORKFLOW_STATE.ASSIGNED || state === WORKFLOW_STATE.DRAFTING || state === WORKFLOW_STATE.RETURNED_FOR_REVISION) {
    targetKey = STAGE.DRAFTED;
  } else if (state === WORKFLOW_STATE.UNDER_REVIEW) {
    const activeReview = reviewSteps.find((s) => s.status === 'IN_PROGRESS' || s.status === 'PENDING');
    targetKey = activeReview ? `${STAGE.REVIEW}-${activeReview.stepId}` : `${STAGE.REVIEW}-0`;
  } else if (state === WORKFLOW_STATE.PENDING_FINAL_APPROVAL) {
    targetKey = STAGE.FINAL_APPROVAL;
  } else if (state === WORKFLOW_STATE.READY_FOR_DISPATCH || state === WORKFLOW_STATE.DISPATCHED) {
    targetKey = STAGE.DISPATCHED;
  } else if (state === WORKFLOW_STATE.CLOSED) {
    targetKey = STAGE.DELIVERED;
  }

  let currentIndex = raw.findIndex((s) => s.key === targetKey);
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  if (state === WORKFLOW_STATE.CLOSED && Boolean(emailAt(EMAIL_TYPE.OUTGOING_RESPONSE))) {
    currentIndex = raw.length;
  }

  return raw.map((stage, index) => {
    const isComplete = index < currentIndex;
    const isCurrent = index === currentIndex;
    return {
      ...stage,
      status: isComplete
        ? STAGE_STATUS.COMPLETE
        : isCurrent
          ? STAGE_STATUS.CURRENT
          : STAGE_STATUS.PENDING,
      note: isCurrent ? (stage.note || returnNote) : undefined,
    };
  });
}
