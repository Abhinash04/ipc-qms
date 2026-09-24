import { AUDIT_EVENT, WORKFLOW_STATE } from './statusEnums';
import { findUserById } from './mockUsers';
import { reviewLevelName, STAGE_STATUS } from './queryLifecycle';

const PENDING_ASSIGNMENT_STATES = [
  WORKFLOW_STATE.RECEIVED,
  WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
  WORKFLOW_STATE.PENDING_ASSIGNMENT,
];

const official = (role, name, status) => ({ role, name: name || null, status });

export function buildCaseOfficials({ query, steps = [], audit = [] } = {}) {
  if (!query) return [];

  const seen = new Set(audit.map((a) => a.event));

  const firstByEvent = new Map();
  for (const entry of audit) {
    if (!firstByEvent.has(entry.event)) firstByEvent.set(entry.event, entry);
  }

  const actorOf = (...events) => {
    for (const event of events) {
      const entry = firstByEvent.get(event);
      if (entry?.actor) return entry.actor;
    }
    return null;
  };

  const state = query.workflowState;
  const rows = [
    official(
      'Inquirer',
      query.inquirer?.name || query.inquirer?.email,
      STAGE_STATUS.COMPLETE,
    ),
  ];

  const forwarded = seen.has(AUDIT_EVENT.QUERY_FORWARDED);
  rows.push(
    official(
      'Front Office',
      actorOf(AUDIT_EVENT.QUERY_FORWARDED, AUDIT_EVENT.QUERY_REGISTERED),
      forwarded
        ? STAGE_STATUS.COMPLETE
        : state === WORKFLOW_STATE.READY_FOR_DISPATCH
          ? STAGE_STATUS.CURRENT
          : state === WORKFLOW_STATE.RECEIVED ||
              state === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION
            ? STAGE_STATUS.CURRENT
            : STAGE_STATUS.PENDING,
    ),
  );

  const assigned = seen.has(AUDIT_EVENT.QUERY_ASSIGNED);
  rows.push(
    official(
      'Officer-in-Charge',
      actorOf(AUDIT_EVENT.QUERY_ASSIGNED),
      state === WORKFLOW_STATE.PENDING_ASSIGNMENT ||
        state === WORKFLOW_STATE.PENDING_FINAL_APPROVAL
        ? STAGE_STATUS.CURRENT
        : assigned
          ? STAGE_STATUS.COMPLETE
          : STAGE_STATUS.PENDING,
    ),
  );

  const assignee = findUserById(query.currentAssigneeId);
  if (assignee || assigned) {
    rows.push(
      official(
        'Assigned Official',
        assignee?.name,
        state === WORKFLOW_STATE.ASSIGNED ||
          state === WORKFLOW_STATE.DRAFTING ||
          state === WORKFLOW_STATE.RETURNED_FOR_REVISION
          ? STAGE_STATUS.CURRENT
          : assigned
            ? STAGE_STATUS.COMPLETE
            : STAGE_STATUS.PENDING,
      ),
    );
  }

  steps
    .filter((s) => s.stepType === 'REVIEW')
    .sort((a, b) => a.sequence - b.sequence)
    .forEach((step, index) => {
      rows.push(
        official(
          reviewLevelName(index),
          findUserById(step.assignedUserId)?.name,
          step.status === 'COMPLETED'
            ? STAGE_STATUS.COMPLETE
            : step.stepId === query.currentWorkflowStepId
              ? STAGE_STATUS.CURRENT
              : STAGE_STATUS.PENDING,
        ),
      );
    });

  const finalStep = steps.find((s) => s.stepType === 'FINAL_APPROVAL');
  if (finalStep && !PENDING_ASSIGNMENT_STATES.includes(state)) {
    rows.push(
      official(
        'Final approval',
        findUserById(finalStep.assignedUserId)?.name,
        seen.has(AUDIT_EVENT.FINAL_APPROVAL_GRANTED)
          ? STAGE_STATUS.COMPLETE
          : state === WORKFLOW_STATE.PENDING_FINAL_APPROVAL
            ? STAGE_STATUS.CURRENT
            : STAGE_STATUS.PENDING,
      ),
    );
  }

  return rows;
}
