import { QueryCase, WorkflowStep, Notification, QueryCounter } from '../../models/index.js';
import * as audit from '../audit/auditService.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { findUserById } from '../../constants/users.js';
import { assignmentClockUpdate } from '../query/assignmentClock.js';
import { PullbackError, STEP_STATUS, planPullback } from './pullbackPlan.js';

export * from './pullbackPlan.js';

const COUNTER_KEY = 'counters';

const pad = (n) => String(n).padStart(5, '0');

const MINT_ATTEMPTS = 5;

const stepNumber = (stepId) => Number(/^STEP-(\d+)$/.exec(stepId || '')?.[1] ?? 0);

async function mintStepIds(count, floor) {
  await QueryCounter.findOneAndUpdate({ key: COUNTER_KEY }, { $max: { 'value.STEP': floor } }, { upsert: true });
  const counter = await QueryCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { 'value.STEP': count } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  const last = counter?.value?.STEP ?? count;
  return Array.from({ length: count }, (_, index) => `STEP-${pad(last - count + 1 + index)}`);
}

const isDuplicateKey = (error) => error?.code === 11000;

async function insertNewSteps(queryId, planned, floor) {
  if (!planned.length) return [];
  for (let attempt = 1; ; attempt += 1) {
    const ids = await mintStepIds(planned.length, floor);
    const rows = planned.map((row, index) => ({ ...row, stepId: ids[index] }));
    try {
      await WorkflowStep.insertMany(rows);
      return rows;
    } catch (error) {
      await WorkflowStep.deleteMany({ queryId, stepId: { $in: ids }, cycle: planned[0].cycle });
      if (!isDuplicateKey(error) || attempt >= MINT_ATTEMPTS) throw error;
    }
  }
}

export async function pullBackQuery({ queryId, targetStage, reviewStepId = null, reason, remarks = '', actor, now = Date.now() }) {
  const query = await QueryCase.findOne({ queryId }).lean();
  if (!query) throw new PullbackError(`No query case ${queryId}`, 404, 'NOT_FOUND');

  const steps = await WorkflowStep.find({ queryId }).lean();
  const plan = planPullback({
    query,
    steps,
    targetStage,
    reviewStepId,
    reason,
    remarks,
    actor,
    now,
    findUser: findUserById,
    clockUpdate: assignmentClockUpdate,
  });

  const floor = Math.max(0, ...steps.map((row) => stepNumber(row.stepId)));
  const newSteps = await insertNewSteps(queryId, plan.newSteps, floor);
  const ids = newSteps.map((row) => row.stepId);
  const currentWorkflowStepId = plan.currentIndex >= 0 ? newSteps[plan.currentIndex].stepId : null;

  const update = {
    $set: { ...plan.patch, currentWorkflowStepId, ...(plan.clock?.set || {}) },
    $push: { pullbackHistory: plan.history, ...(plan.clock?.push || {}) },
    $inc: { revision: 1 },
  };
  const updated = await QueryCase.findOneAndUpdate(
    {
      queryId,
      workflowState: query.workflowState,
      revision: query.revision ? query.revision : { $in: [0, null] },
    },
    update,
    { returnDocument: 'after' },
  ).lean();

  if (!updated) {
    if (newSteps.length) await WorkflowStep.deleteMany({ stepId: { $in: ids }, queryId });
    throw new PullbackError(`${queryId} was changed by someone else — reload and try again.`, 409, 'STALE_CASE');
  }

  if (plan.supersededStepIds.length) {
    await WorkflowStep.updateMany(
      { queryId, stepId: { $in: plan.supersededStepIds } },
      { $set: { status: STEP_STATUS.SUPERSEDED, supersededAt: plan.patch.updatedAt } },
    );
  }

  await Notification.findOneAndUpdate(
    { notificationId: plan.notification.notificationId },
    { $set: plan.notification },
    { upsert: true },
  );

  await audit.record({
    action: 'QUERY_PULLED_BACK',
    timestamp: plan.patch.updatedAt,
    queryId,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    details: plan.auditDetails,
  });

  const { _id, ...plain } = updated;
  return {
    query: plain,
    newSteps,
    supersededStepIds: plan.supersededStepIds,
    history: plan.history,
    reviewLevel: plan.reviewLevel,
  };
}
