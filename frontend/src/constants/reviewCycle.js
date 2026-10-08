import { WORKFLOW_STATE } from './statusEnums';

export const PULLBACK_RANK = Object.freeze({
  [WORKFLOW_STATE.RECEIVED]: 0,
  [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION]: 1,
  [WORKFLOW_STATE.PENDING_ASSIGNMENT]: 2,
  [WORKFLOW_STATE.ASSIGNED]: 3,
  [WORKFLOW_STATE.DRAFTING]: 4,
  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: 4,
  [WORKFLOW_STATE.UNDER_REVIEW]: 5,
  [WORKFLOW_STATE.PENDING_FINAL_APPROVAL]: 6,
});

export const STEP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SUPERSEDED: 'SUPERSEDED',
});

export const cycleOfQuery = (query) => query?.reviewCycle ?? 0;
export const cycleOfStep = (step) => step?.cycle ?? 0;

const ofQuery = (steps, query) =>
  (steps || []).filter((step) => step.queryId === query?.queryId).sort((a, b) => a.sequence - b.sequence);

export function activeSteps(steps, query) {
  if (!query) return [];
  const cycle = cycleOfQuery(query);
  return ofQuery(steps, query).filter((step) => cycleOfStep(step) === cycle);
}

export function historicalSteps(steps, query) {
  if (!query) return [];
  const cycle = cycleOfQuery(query);
  return ofQuery(steps, query)
    .filter((step) => cycleOfStep(step) !== cycle)
    .sort((a, b) => cycleOfStep(a) - cycleOfStep(b) || a.sequence - b.sequence);
}

export const isPullbackSource = (state) => state in PULLBACK_RANK;

export function reviewLevelTargets(query, steps) {
  if (!query) return [];
  const chain = activeSteps(steps, query).filter((step) => step.stepType === 'REVIEW');
  if (query.workflowState === WORKFLOW_STATE.PENDING_FINAL_APPROVAL) return chain;
  if (query.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return [];
  const current = chain.findIndex((step) => step.stepId === query.currentWorkflowStepId);
  return current > 0 ? chain.slice(0, current) : [];
}
