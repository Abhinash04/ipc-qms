import { QueryCase, ResponseVersion, WorkflowStep } from '../../models/index.js';
import * as caseMail from '../email/caseMail.js';
import { OUTCOMES } from '../email/outbox.js';
import * as audit from '../audit/auditService.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { NEEDS_APPROVAL, ALREADY_APPROVED } from '../../constants/workflowStates.js';

const record = (actor, event) => ({
  action: event,
  actorType: ACTOR_TYPES.HUMAN,
  actorId: actor?.id ?? null,
  actorRole: actor?.role ?? null,
});

export async function grantFinalApproval({ queryId, actor, comment = '' }) {
  const errors = [];

  const query = await QueryCase.findOne({ queryId }).lean();
  if (!query) {
    throw Object.assign(new Error(`Query case ${queryId} does not exist`), { status: 404 });
  }

  const needsApproval = NEEDS_APPROVAL.includes(query.workflowState);

  if (!needsApproval && !ALREADY_APPROVED.includes(query.workflowState)) {
    throw Object.assign(
      new Error(
        `${queryId} is ${query.workflowState} and cannot be finally approved — ` +
          `expected one of ${NEEDS_APPROVAL.join(', ')}`,
      ),
      { status: 409 },
    );
  }

  const approvedVersion = (
    await ResponseVersion.find({ queryId }).sort({ createdAt: 1 }).lean()
  ).at(-1);

  if (!approvedVersion) {
    throw Object.assign(new Error(`${queryId} has no drafted response to approve`), { status: 409 });
  }

  const now = () => new Date().toISOString();
  const recipient = query.inquirer?.email || null;
  if (needsApproval) {
    const moved = await QueryCase.findOneAndUpdate(
      { queryId, workflowState: { $in: NEEDS_APPROVAL } },
      { $set: { workflowState: 'READY_FOR_DISPATCH', updatedAt: now() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    ).lean();

    if (!moved) {
      return {
        queryId,
        approved: true,
        dispatched: false,
        alreadyDispatched: false,
        inProgress: true,
        uncertain: false,
        outcome: OUTCOMES.IN_PROGRESS,
        workflowState: 'READY_FOR_DISPATCH',
        recipient,
        errors,
      };
    }

    await ResponseVersion.updateOne(
      { responseId: approvedVersion.responseId },
      { $set: { status: 'FINAL_APPROVED', approvedAt: now() } },
    );

    await WorkflowStep.updateMany(
      { queryId, status: { $ne: 'COMPLETED' } },
      { $set: { status: 'COMPLETED', completedAt: now() } },
    );

    await audit.record({
      ...record(actor, 'FINAL_APPROVAL_GRANTED'),
      queryId,
      details:
        `Final approval granted; ${approvedVersion.version} locked and ready for dispatch.` +
        (comment ? ` ${comment}` : ''),
    });
  }

  const result = await caseMail.dispatchResponse({ queryId, actor });
  const { outcome } = result;
  const dispatched = outcome === OUTCOMES.SENT;
  const alreadyDispatched = outcome === OUTCOMES.ALREADY_SENT;
  const inProgress = outcome === OUTCOMES.IN_PROGRESS;
  const uncertain = outcome === OUTCOMES.UNCERTAIN || outcome === OUTCOMES.BLOCKED_UNCERTAIN;

  if (!dispatched && !alreadyDispatched && !inProgress) {
    errors.push({
      step: 'dispatch',
      outcome,
      error: result.error || 'The response could not be sent.',
      ...(uncertain ? { unconfirmed: true } : {}),
      ...(outcome === OUTCOMES.FAILED ? { retryable: true } : {}),
    });
  }

  return {
    queryId,
    approved: true,
    dispatched,
    alreadyDispatched,
    inProgress,
    uncertain,
    outcome,
    workflowState: dispatched || alreadyDispatched ? 'CLOSED' : 'READY_FOR_DISPATCH',
    recipient,
    errors,
  };
}
