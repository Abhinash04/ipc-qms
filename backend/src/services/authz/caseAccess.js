import { ROLES } from '../../constants/roles.js';
import { isConnected } from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatus.js';
import { QueryCase, WorkflowStep, Review } from '../../models/index.js';

/**
 * Who may see and touch which case — the server-side half of per-case access.
 *
 * This is a port of the scope predicates the CLIENT has always applied in
 * frontend/src/constants/queryBuckets.js (`ROLE_BUCKETS[*].scope`). Until now
 * they ran only in the browser, so `GET /queries` returned every case to every
 * signed-in account and `POST /queries/persist` accepted a write to any case
 * from any account — including an official with no part in it.
 *
 * ## One resolution, two consumers
 *
 * A predicate and a list filter written separately WILL drift, and a drift here
 * is a silent authorization hole. So membership is resolved once, to a set of
 * queryIds:
 *
 *   - the list filter is  { queryId: { $in: [...ids] } }
 *   - the predicate is    ids.has(queryId)
 *
 * There is no second code path to keep in step. It is also the only shape that
 * scopes all eight collections uniformly, since every one of them carries a
 * `queryId` while only QueryCase carries the fields membership is derived from.
 *
 * ## What this does NOT establish
 *
 * Every field membership is derived from — `currentAssigneeId`,
 * `WorkflowStep.assignedUserId`, `Review.reviewerId` — is written by the client
 * through `POST /queries/persist`. Scope is therefore ALWAYS resolved from the
 * database as it stands *before* a delta is applied, and never from a value in
 * the submitted body; middleware/authorizeCaseDelta.js is what keeps that true.
 * Anyone already party to a case can still write any field on it: there is no
 * server-side state machine yet, so this bounds *which* cases a principal can
 * reach, not what they may do once inside one.
 */

/** Roles that see every case. Mirrors the `everything` scope in queryBuckets.js. */
const EVERYTHING_ROLES = new Set([
  ROLES.FRONT_OFFICE,
  ROLES.OFFICER_IN_CHARGE,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
]);

/** Roles narrowed to the cases they are party to. */
const SCOPED_ROLES = new Set([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]);

export const SCOPE_KIND = { EVERYTHING: 'EVERYTHING', SCOPED: 'SCOPED', NONE: 'NONE' };

/** `NONE` for an unknown or absent role — fail closed rather than guessing. */
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

/**
 * The cases this principal may see.
 *
 * `null` means "every case" and is returned WITHOUT touching the database —
 * that early return is a correctness requirement, not an optimisation. A
 * SUPER_ADMIN is party to no case in the data sense, so computing membership
 * for them yields the empty set and blanks every dashboard in the application.
 */
export async function visibleQueryIds(user) {
  const kind = scopeKindForRole(user?.role);

  if (kind === SCOPE_KIND.EVERYTHING) return null;
  if (kind === SCOPE_KIND.NONE) return new Set();

  // Refusing is the only safe answer: with no connection we cannot tell which
  // cases are theirs, and "cannot tell" must never widen to "all of them".
  if (!isConnected()) throw scopeUnavailable();

  if (user.role === ROLES.REVIEWER) {
    const [fromSteps, fromReviews] = await Promise.all([
      WorkflowStep.distinct('queryId', { assignedUserId: user.id }),
      Review.distinct('queryId', { reviewerId: user.id }),
    ]);
    return new Set([...fromSteps, ...fromReviews]);
  }

  /**
   * ASSIGNED_OFFICIAL, deliberately WIDER than the client's `isAssignedTo`.
   *
   * The client tests only the *current* assignee and the *current* step, which
   * is right for "what is on my desk" but wrong for visibility: an official who
   * drafted a case loses sight of it the moment it moves to a reviewer, history
   * included. Any step ever assigned to them is a strict superset of the client
   * predicate, so every client-side bucket still displays exactly as before.
   */
  const myStepQueryIds = await WorkflowStep.distinct('queryId', { assignedUserId: user.id });
  const assigned = await QueryCase.distinct('queryId', { currentAssigneeId: user.id });
  return new Set([...myStepQueryIds, ...assigned]);
}

/**
 * The resolved scope for one request, memoised on the request object.
 *
 * `authorizeCaseDelta` and the controller behind it both need the scope, and
 * resolving it twice would double the round trips for no benefit.
 */
const SCOPE = Symbol('caseScope');

export async function caseScopeFor(req) {
  if (req[SCOPE]) return req[SCOPE];
  const ids = await visibleQueryIds(req.user);
  // userId and role ride along so a consumer scoping a collection that keys on
  // the recipient rather than the case (Notification) does not have to reach
  // back into req.user and risk disagreeing about who the principal is.
  req[SCOPE] = {
    everything: ids === null,
    ids,
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
  };
  return req[SCOPE];
}

/**
 * A Mongoose filter for the resolved scope: `{}` for everything, otherwise an
 * `$in` over the visible ids. `field` names the id on collections that do not
 * call it `queryId`.
 */
export function scopeFilter(scope, field = 'queryId') {
  if (!scope || scope.everything) return {};
  return { [field]: { $in: [...scope.ids] } };
}

/** Is this principal party to this case? */
export async function isPartyToCase(user, queryId) {
  const ids = await visibleQueryIds(user);
  return ids === null ? true : ids.has(queryId);
}

/** As above, but throws a 403 rather than returning false. */
export async function assertPartyToCase(user, queryId) {
  if (await isPartyToCase(user, queryId)) return;
  throw Object.assign(new Error('You are not permitted to access this case'), {
    status: HTTP_STATUS.FORBIDDEN,
  });
}
