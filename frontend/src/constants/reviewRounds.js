import { findUserById } from './mockUsers';
import { isSendBack, reviewLevelName } from './queryLifecycle';
import { cycleOfStep } from './reviewCycle';

const byTime = (a, b) => String(a.at).localeCompare(String(b.at));

export { isSendBack };

export const DECISION_LABEL = Object.freeze({
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Rejected',
});

export const DECISION_VARIANT = Object.freeze({
  APPROVED: 'status-green',
  CHANGES_REQUESTED: 'status-orange',
  REJECTED: 'status-red',
});

export function requesterRole(review, steps = []) {
  if (!review?.stepId) return 'Officer-in-Charge';
  const step = steps.find((s) => s.stepId === review.stepId);
  if (!step) return 'Reviewer';
  const chain = steps
    .filter((s) => s.stepType === 'REVIEW' && s.queryId === step.queryId && cycleOfStep(s) === cycleOfStep(step))
    .sort((a, b) => a.sequence - b.sequence);
  const index = chain.findIndex((s) => s.stepId === step.stepId);
  return index >= 0 ? reviewLevelName(index) : 'Reviewer';
}

export function pendingChangeRequest({ reviews = [], versions = [], query = null } = {}) {
  const sorted = [...reviews].sort(byTime);
  const request = [...sorted].reverse().find(isSendBack);
  if (!request) return null;
  const lastPullback = (query?.pullbackHistory || []).map((h) => String(h?.pulledBackAt || '')).sort().at(-1);
  if (lastPullback && String(request.at) <= lastPullback) return null;
  const answered = versions.some((v) => v.respondsToReviewId === request.reviewId);
  const reviewedSince = sorted.some((r) => r !== request && String(r.at) > String(request.at));
  return answered || reviewedSince ? null : request;
}

export function buildReviewRounds({ reviews = [], versions = [], steps = [] } = {}) {
  const requests = reviews.filter(isSendBack).sort(byTime);

  return requests.map((request, index) => ({
    round: index + 2,
    request,
    rejected: request.decision === 'REJECTED',
    requestedBy: findUserById(request.reviewerId)?.name || 'Unknown reviewer',
    requesterRole: requesterRole(request, steps),
    reviewedVersion: versions.find((v) => v.responseId === request.responseId) || null,
    resubmittedVersion: versions.find((v) => v.respondsToReviewId === request.reviewId) || null,
  }));
}

export function currentResubmission({ reviews, versions, steps, latestVersion } = {}) {
  if (!latestVersion?.respondsToReviewId) return null;
  const rounds = buildReviewRounds({ reviews, versions, steps });
  const current = rounds.find((r) => r.request.reviewId === latestVersion.respondsToReviewId);
  if (!current) return null;
  return { current, earlier: rounds.filter((r) => r !== current && r.round < current.round) };
}
