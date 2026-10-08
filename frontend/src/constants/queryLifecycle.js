import { AUDIT_EVENT, SERVER_EVENTS, WORKFLOW_STATE } from './statusEnums';
import { EMAIL_TYPE } from './emailModel';
import { findUserById } from './mockUsers';
import { ROLE_LABELS } from './roles';

export const LEVEL_NAMES = ['Reviewer I', 'Reviewer II', 'Reviewer III'];

export const reviewLevelName = (index) => LEVEL_NAMES[index] || `Reviewer ${index + 1}`;

export const SEND_BACK_DECISIONS = Object.freeze(['CHANGES_REQUESTED', 'REJECTED']);
export const isSendBack = (review) => SEND_BACK_DECISIONS.includes(review?.decision);

const byTime = (a, b) => String(a.at).localeCompare(String(b.at));
const latest = (rows) => rows.filter((row) => row?.at).sort(byTime).at(-1) || null;

export function auditActor(entry, fallbackRole) {
  const user = entry?.actorId ? findUserById(entry.actorId) : null;
  const roleCode = entry?.actorRole || (ROLE_LABELS[entry?.actor] ? entry.actor : null);
  const name = user?.name || (entry?.actor && !ROLE_LABELS[entry.actor] ? entry.actor : null);
  return { actor: name, role: ROLE_LABELS[roleCode] || fallbackRole || null };
}

const fromAudit = (entry, action, fallbackRole) =>
  entry ? { ...auditActor(entry, fallbackRole), action, at: entry.at } : null;

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
  // The automatic-reply path: an eligible mail the Front Office accepted, answered by the AI agent.
  AI_IDENTIFIED: 'AI_IDENTIFIED',
  FO_APPROVED: 'FO_APPROVED',
  AI_SUMMARY_ACK: 'AI_SUMMARY_ACK',
  AI_REPLY: 'AI_REPLY',
  REPLY_SENT: 'REPLY_SENT',
};

const AI_AGENT = 'AI Agent';

// The current stage is the one after the last stage done, so a later step that succeeded is
// never held back by an earlier one that failed.
function withStatuses(stages, done) {
  const lastDone = done.findLastIndex(Boolean);
  const currentIndex = lastDone + 1;
  return stages.map((stage, index) => {
    const status = index <= lastDone ? STAGE_STATUS.COMPLETE : index === currentIndex ? STAGE_STATUS.CURRENT : STAGE_STATUS.PENDING;
    return { ...stage, status, note: status === STAGE_STATUS.CURRENT ? stage.note : undefined };
  });
}

/**
 * The automatic-reply path: the AI found the mail eligible, the Front Office accepted it, and the
 * AI agent summarised, acknowledged, prepared the reply and sent it. Nothing goes to the OIC.
 */
function buildAutoReplyLifecycle({ query, audit, messages }) {
  const lastOf = (...events) => {
    const wanted = new Set(events);
    return latest(audit.filter((entry) => wanted.has(entry.event)));
  };
  const outgoing = messages.find((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)?.timestamp || null;
  const { confidence = 1, topic = null } = query.autoReply;
  const inquirer = query.inquirer?.name || null;

  const received = lastOf(AUDIT_EVENT.QUERY_RECEIVED);
  const accepted = lastOf(AUDIT_EVENT.QUERY_REGISTERED);
  const summarised = lastOf(AUDIT_EVENT.AI_SUMMARY_GENERATED);
  const acknowledged = lastOf(AUDIT_EVENT.ACKNOWLEDGEMENT_SENT);
  const prepared = lastOf(SERVER_EVENTS.AUTO_REPLY_PREPARED, SERVER_EVENTS.AUTO_REPLY_APPROVED);
  const dispatched = lastOf(AUDIT_EVENT.RESPONSE_DISPATCHED);
  const sentAt = dispatched?.at || (query.workflowState === WORKFLOW_STATE.CLOSED ? outgoing : null);
  const submittedAt = received?.at || query.createdAt;

  const stages = [
    {
      key: STAGE.SUBMITTED,
      label: 'Enquiry submitted',
      actor: inquirer,
      at: submittedAt,
      activity: { actor: inquirer, role: 'External inquirer', action: 'Sent the enquiry by email', at: submittedAt },
    },
    {
      key: STAGE.AI_IDENTIFIED,
      label: `AI identified — ${Math.round(confidence * 100)}% confidence (eligible for Auto Reply)`,
      actor: AI_AGENT,
      at: submittedAt,
      activity: {
        actor: AI_AGENT,
        role: 'Auto Reply check',
        action: topic ? `Matched the supported question on ${topic.toLowerCase()}` : 'Matched a supported question',
        at: submittedAt,
      },
    },
    {
      key: STAGE.FO_APPROVED,
      label: 'FO approved',
      actor: 'Front Office',
      at: accepted?.at || null,
      activity: fromAudit(accepted, 'Accepted the query for an automatic reply', ROLE_LABELS.FRONT_OFFICE),
    },
    {
      key: STAGE.AI_SUMMARY_ACK,
      label: 'AI Agent generated summary & acknowledgement',
      actor: AI_AGENT,
      at: acknowledged?.at || null,
      activity: acknowledged
        ? {
            actor: AI_AGENT,
            role: 'On behalf of the Front Office',
            action: summarised
              ? 'Summarised the query and acknowledged the inquirer by email'
              : 'Acknowledged the inquirer by email',
            at: acknowledged.at,
          }
        : null,
    },
    {
      key: STAGE.AI_REPLY,
      label: 'AI Agent generated reply',
      actor: AI_AGENT,
      at: prepared?.at || null,
      activity: prepared
        ? { actor: AI_AGENT, role: 'On behalf of the Front Office', action: 'Prepared the reply from the supported question', at: prepared.at }
        : null,
    },
    {
      key: STAGE.REPLY_SENT,
      label: 'Reply sent to external inquirer',
      actor: inquirer,
      at: sentAt,
      note: prepared && !sentAt ? 'Not sent yet — retry from the mail in the IPC Mailbox' : undefined,
      activity: sentAt
        ? {
            actor: inquirer,
            role: 'External inquirer',
            action: `Reply emailed to ${query.inquirer?.email || 'the inquirer'}`,
            at: sentAt,
          }
        : null,
    },
  ];

  return withStatuses(stages, [true, true, Boolean(accepted), Boolean(acknowledged), Boolean(prepared), Boolean(sentAt)]);
}

export function buildLifecycle({
  query,
  steps = [],
  versions = [],
  reviews = [],
  audit = [],
  messages = [],
} = {}) {
  if (!query) return [];
  if (query.autoReply) return buildAutoReplyLifecycle({ query, audit, messages });

  const at = (event) => audit.find((a) => a.event === event)?.at || null;
  const emailAt = (emailType) =>
    messages.find((m) => m.emailType === emailType)?.timestamp || null;

  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const finalStep = steps.find((s) => s.stepType === 'FINAL_APPROVAL');
  const draftLabel = versions.length
    ? `Response drafted (v${versions.length})`
    : 'Response drafted';

  // Pull backs and change requests are not noted here: they are actions on the workflow line
  // (see workflowSequence).

  const lastOf = (...events) => {
    const wanted = new Set(events);
    return latest(audit.filter((entry) => wanted.has(entry.event)));
  };
  const assigneeName = findUserById(query.currentAssigneeId)?.name || 'an official';
  const latestVersion =
    [...versions].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).at(-1) || null;

  const received = lastOf(AUDIT_EVENT.QUERY_RECEIVED);
  const verified = lastOf(AUDIT_EVENT.QUERY_REGISTERED, AUDIT_EVENT.ACKNOWLEDGEMENT_SENT);
  const forwarded = lastOf(AUDIT_EVENT.QUERY_FORWARDED);

  const assigned =
    lastOf(AUDIT_EVENT.QUERY_ASSIGNED) ||
    lastOf(AUDIT_EVENT.QUERY_TRANSFERRED, SERVER_EVENTS.QUERY_AUTO_TRANSFERRED);
  const dispatched = lastOf(AUDIT_EVENT.RESPONSE_DISPATCHED);

  let assignedActivity = null;
  if (assigned?.event === SERVER_EVENTS.QUERY_AUTO_TRANSFERRED) {
    assignedActivity = {
      actor: 'BRIDGETECH',
      role: 'Automatic transfer',
      action: `Transferred the query to ${assigneeName} after the action deadline passed`,
      at: assigned.at,
    };
  } else if (assigned) {
    const transferred = assigned.event === AUDIT_EVENT.QUERY_TRANSFERRED;
    assignedActivity = fromAudit(
      assigned,
      `${transferred ? 'Transferred' : 'Assigned'} the query to ${assigneeName}`,
      transferred ? ROLE_LABELS.ASSIGNED_OFFICIAL : ROLE_LABELS.OFFICER_IN_CHARGE,
    );
  }

  let draftActivity = null;
  if (latestVersion?.submittedAt) {
    draftActivity = {
      actor: findUserById(latestVersion.submittedBy)?.name || latestVersion.createdBy || null,
      role: ROLE_LABELS.ASSIGNED_OFFICIAL,
      action: latestVersion.respondsToReviewId
        ? `Resubmitted ${latestVersion.version} for review after it was sent back`
        : `Submitted ${latestVersion.version} for review`,
      version: latestVersion.version,
      at: latestVersion.submittedAt,
    };
  } else if (latestVersion) {
    draftActivity = {
      actor: latestVersion.createdBy || null,
      role: ROLE_LABELS.ASSIGNED_OFFICIAL,
      action: latestVersion.aiGenerated ? `Generated AI draft ${latestVersion.version}` : `Saved ${latestVersion.version}`,
      version: latestVersion.version,
      at: latestVersion.createdAt,
    };
  }

  const raw = [
    {
      key: STAGE.SUBMITTED,
      label: 'Enquiry submitted',
      actor: query.inquirer?.name || null,
      at: at(AUDIT_EVENT.QUERY_RECEIVED) || query.createdAt,
      activity: {
        actor: query.inquirer?.name || null,
        role: 'External inquirer',
        action: 'Sent the enquiry by email',
        at: received?.at || query.createdAt,
      },
    },
    {
      key: STAGE.VERIFIED,
      label: 'Verified & acknowledged',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.QUERY_REGISTERED) || emailAt(EMAIL_TYPE.ACKNOWLEDGEMENT),
      activity: fromAudit(
        verified,
        verified?.event === AUDIT_EVENT.ACKNOWLEDGEMENT_SENT ? 'Acknowledged the inquirer by email' : 'Registered the query',
        ROLE_LABELS.FRONT_OFFICE,
      ),
    },
    {
      key: STAGE.FORWARDED,
      label: 'Forwarded to Officer-in-Charge',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.QUERY_FORWARDED),
      activity: fromAudit(forwarded, 'Forwarded the query to the Officer-in-Charge', ROLE_LABELS.FRONT_OFFICE),
    },
    {
      key: STAGE.ASSIGNED,
      label: 'Assigned to an official',
      actor: findUserById(query.currentAssigneeId)?.name || null,
      at: at(AUDIT_EVENT.QUERY_ASSIGNED),
      activity: assignedActivity,
    },
    {
      key: STAGE.DRAFTED,
      label: draftLabel,
      actor: findUserById(query.currentAssigneeId)?.name || null,
      at: at(AUDIT_EVENT.DRAFT_GENERATED),
      activity: draftActivity,
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
      const level = reviewLevelName(index);
      const reviewer = findUserById(step.assignedUserId)?.name || null;
      const decision = latest(reviews.filter((r) => r.stepId === step.stepId));
      const next = index + 1 < reviewSteps.length ? reviewLevelName(index + 1) : 'the Officer-in-Charge';
      const reviewed = decision?.version || 'the response';
      raw.push({
        key: `${STAGE.REVIEW}-${step.stepId}`,
        label: level,
        actor: reviewer,
        at: step.completedAt,
        activity: decision
          ? {
              actor: findUserById(decision.reviewerId)?.name || reviewer,
              role: level,
              action:
                decision.decision === 'APPROVED'
                  ? `Approved ${reviewed} and forwarded it to ${next}`
                  : `Requested changes on ${reviewed}`,
              version: decision.version || null,
              at: decision.at,
            }
          : {
              actor: reviewer,
              role: level,
              action: step.status === 'IN_PROGRESS' ? 'Reviewing now' : 'Not started yet',
              pending: true,
            },
      });
    });
  }

  const oicDecision = latest(reviews.filter((r) => !r.stepId && isSendBack(r)));
  const granted = lastOf(AUDIT_EVENT.FINAL_APPROVAL_GRANTED);
  const approvedVersion = versions.find((v) => v.status === 'FINAL_APPROVED')?.version || null;
  let finalActivity = null;
  if (granted && (!oicDecision || String(granted.at) > String(oicDecision.at))) {
    finalActivity = {
      ...fromAudit(granted, 'Approved the response for dispatch', ROLE_LABELS.OFFICER_IN_CHARGE),
      version: approvedVersion,
    };
  } else if (oicDecision) {
    const sentBack = oicDecision.version || 'the response';
    finalActivity = {
      actor: findUserById(oicDecision.reviewerId)?.name || null,
      role: ROLE_LABELS.OFFICER_IN_CHARGE,
      action: oicDecision.decision === 'REJECTED' ? `Rejected ${sentBack}` : `Returned ${sentBack} for revision`,
      version: oicDecision.version || null,
      at: oicDecision.at,
    };
  }
  if (!finalActivity) {
    finalActivity = {
      actor: findUserById(finalStep?.assignedUserId)?.name || null,
      role: ROLE_LABELS.OFFICER_IN_CHARGE,
      action:
        query.workflowState === WORKFLOW_STATE.PENDING_FINAL_APPROVAL ? 'Awaiting the final approval decision' : 'Not started yet',
      pending: true,
    };
  }

  let dispatchActivity = null;
  if (dispatched?.actorId) {
    dispatchActivity = fromAudit(dispatched, 'Emailed the approved response to the inquirer', ROLE_LABELS.FRONT_OFFICE);
  } else if (dispatched) {
    dispatchActivity = {
      actor: 'BRIDGETECH',
      role: 'Sent automatically on approval',
      action: 'Emailed the approved response to the inquirer',
      at: dispatched.at,
    };
  }
  const outgoingAt = emailAt(EMAIL_TYPE.OUTGOING_RESPONSE);

  raw.push(
    {
      key: STAGE.FINAL_APPROVAL,
      label: 'Final approval',
      actor: findUserById(finalStep?.assignedUserId)?.name || 'Officer-in-Charge',
      at: at(AUDIT_EVENT.FINAL_APPROVAL_GRANTED),
      activity: finalActivity,
    },
    {
      key: STAGE.DISPATCHED,
      label: 'Response dispatched',
      actor: 'Front Office',
      at: at(AUDIT_EVENT.RESPONSE_DISPATCHED),
      activity: dispatchActivity,
    },
    {
      key: STAGE.DELIVERED,
      label: 'Inquirer received response',
      actor: query.inquirer?.name || null,
      at: outgoingAt,
      activity: outgoingAt
        ? { actor: query.inquirer?.name || null, role: 'External inquirer', action: 'Response emailed to the inquirer', at: outgoingAt }
        : null,
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
      note: isCurrent ? stage.note : undefined,
    };
  });
}
