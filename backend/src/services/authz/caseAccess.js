import { ROLES } from '../../constants/roles.js';
import { isConnected } from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatus.js';
import { QueryCase, WorkflowStep, Review } from '../../models/index.js';
const EVERYTHING_ROLES = new Set([
  ROLES.FRONT_OFFICE,
  ROLES.OFFICER_IN_CHARGE,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
]);

const SCOPED_ROLES = new Set([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]);
export const SCOPE_KIND = { EVERYTHING: 'EVERYTHING', SCOPED: 'SCOPED', NONE: 'NONE' };
export function scopeKindForRole(role) {
  if (EVERYTHING_ROLES.has(role)) return SCOPE_KIND.EVERYTHING;
  if (SCOPED_ROLES.has(role)) return SCOPE_KIND.SCOPED;
  return SCOPE_KIND.NONE;
}

function scopeUnavailable() {
  return Object.assign(new Error('Case access cannot be determined: query storage is unavailable'), {
    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
  });
}

export async function visibleQueryIds(user) {
  const kind = scopeKindForRole(user?.role);
  if (kind === SCOPE_KIND.EVERYTHING) return null;
  if (kind === SCOPE_KIND.NONE) return new Set();
  if (!isConnected()) throw scopeUnavailable();
  if (user.role === ROLES.REVIEWER) {
    const [fromSteps, fromReviews] = await Promise.all([
      WorkflowStep.distinct('queryId', { assignedUserId: user.id }),
      Review.distinct('queryId', { reviewerId: user.id }),
    ]);
    return new Set([...fromSteps, ...fromReviews]);
  }

  const myStepQueryIds = await WorkflowStep.distinct('queryId', { assignedUserId: user.id });
  const assigned = await QueryCase.distinct('queryId', { currentAssigneeId: user.id });
  return new Set([...myStepQueryIds, ...assigned]);
}

const SCOPE = Symbol('caseScope');

export async function caseScopeFor(req) {
  if (req[SCOPE]) return req[SCOPE];
  const ids = await visibleQueryIds(req.user);
  req[SCOPE] = {
    everything: ids === null,
    ids,
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
  };
  return req[SCOPE];
}

export function scopeFilter(scope, field = 'queryId') {
  if (!scope || scope.everything) return {};
  return { [field]: { $in: [...scope.ids] } };
}

export async function isPartyToCase(user, queryId) {
  const ids = await visibleQueryIds(user);
  return ids === null ? true : ids.has(queryId);
}

export async function assertPartyToCase(user, queryId) {
  if (await isPartyToCase(user, queryId)) return;
  throw Object.assign(new Error('You are not permitted to access this case'), {
    status: HTTP_STATUS.FORBIDDEN,
  });
}
