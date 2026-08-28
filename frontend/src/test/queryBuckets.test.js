import { describe, it, expect } from 'vitest';

import {
  ROLE_BUCKETS,
  bucketsForRole,
  visibleQueries,
  bucketRecords,
  defaultBucketKey,
  anyBucket,
  roleScope,
  isAssignedTo,
  isActiveWorkFor,
  isAwaitingReviewBy,
} from '@/constants/queryBuckets';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '@/constants/statusEnums';
import { deriveBusinessStatus } from '@/constants/workflowRules';
import { ROLES } from '@/constants/roles';

const OFFICIAL = { id: 'USR-0004', role: ROLES.ASSIGNED_OFFICIAL };
const OTHER_OFFICIAL = { id: 'USR-0006', role: ROLES.ASSIGNED_OFFICIAL };
const REVIEWER = { id: 'USR-0005', role: ROLES.REVIEWER };
const OTHER_REVIEWER = { id: 'USR-0007', role: ROLES.REVIEWER };
const INQUIRER = { id: 'USR-0001', role: ROLES.INQUIRER, email: 'abhinash@example.com' };

const ALL_STATES = Object.values(WORKFLOW_STATE);

/** One query per workflow state, all owned by the same people. */
function queryInState(state, overrides = {}) {
  return {
    queryId: `QRY-${state}`,
    subject: state,
    workflowState: state,
    businessStatus: deriveBusinessStatus(state),
    inquirer: { id: INQUIRER.id, email: INQUIRER.email },
    currentAssigneeId: OFFICIAL.id,
    currentWorkflowStepId: `STP-${state}`,
    createdAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

const EVERY_STATE = ALL_STATES.map((state) => queryInState(state));

const stepsFor = (queries, assignedUserId) =>
  queries.map((q) => ({
    stepId: q.currentWorkflowStepId,
    queryId: q.queryId,
    stepType: 'REVIEW',
    assignedUserId,
  }));

describe('ownership predicates', () => {
  const steps = stepsFor(EVERY_STATE, REVIEWER.id);

  it('isAssignedTo holds for every state, so completed work stays attributable', () => {
    const closed = queryInState(WORKFLOW_STATE.CLOSED);
    expect(isAssignedTo(closed, [], OFFICIAL)).toBe(true);
    expect(isAssignedTo(closed, [], OTHER_OFFICIAL)).toBe(false);
  });

  it('isActiveWorkFor drops anything past the active stages', () => {
    expect(isActiveWorkFor(queryInState(WORKFLOW_STATE.DRAFTING), [], OFFICIAL)).toBe(true);
    expect(isActiveWorkFor(queryInState(WORKFLOW_STATE.CLOSED), [], OFFICIAL)).toBe(false);
    expect(isActiveWorkFor(queryInState(WORKFLOW_STATE.DISPATCHED), [], OFFICIAL)).toBe(false);
  });

  it('isAwaitingReviewBy needs UNDER_REVIEW and ownership of the current step', () => {
    const underReview = queryInState(WORKFLOW_STATE.UNDER_REVIEW);
    expect(isAwaitingReviewBy(underReview, steps, REVIEWER)).toBe(true);
    expect(isAwaitingReviewBy(underReview, steps, OTHER_REVIEWER)).toBe(false);
    expect(isAwaitingReviewBy(queryInState(WORKFLOW_STATE.DRAFTING), steps, REVIEWER)).toBe(false);
  });

  it('no predicate matches when there is no signed-in user', () => {
    const q = queryInState(WORKFLOW_STATE.DRAFTING);
    expect(isAssignedTo(q, [], null)).toBe(false);
    expect(isActiveWorkFor(q, [], null)).toBe(false);
    expect(isAwaitingReviewBy(q, [], null)).toBe(false);
  });
});

describe('every role has buckets, and they never double-count', () => {
  const roles = Object.keys(ROLE_BUCKETS);

  it('covers every role in the app', () => {
    for (const role of Object.values(ROLES)) {
      expect(bucketsForRole(role).length, role).toBeGreaterThan(0);
    }
  });

  it.each(roles)('%s buckets are mutually exclusive', (role) => {
    const ctx = {
      user: role === ROLES.REVIEWER ? REVIEWER : role === ROLES.INQUIRER ? INQUIRER : OFFICIAL,
      workflowSteps: stepsFor(EVERY_STATE, REVIEWER.id),
      reviews: [],
    };
    const buckets = bucketsForRole(role).filter((b) => !b.aggregate);

    for (const query of visibleQueries(EVERY_STATE, role, ctx)) {
      const hits = buckets.filter((b) => b.predicate(query, ctx)).map((b) => b.key);
      expect(hits.length, `${role} / ${query.workflowState} matched ${hits.join(', ')}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it.each(roles)('%s bucket keys are unique', (role) => {
    const keys = bucketsForRole(role).map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Total Queries means "everything in my scope, any status"', () => {
  const roles = Object.values(ROLES);

  const ctxFor = (role) => ({
    user: role === ROLES.REVIEWER ? REVIEWER : role === ROLES.INQUIRER ? INQUIRER : OFFICIAL,
    workflowSteps: stepsFor(EVERY_STATE, REVIEWER.id),
    reviews: EVERY_STATE.map((q, i) => ({
      queryId: q.queryId,
      reviewerId: REVIEWER.id,
      decision: i % 2 ? 'APPROVED' : 'CHANGES_REQUESTED',
    })),
  });

  it.each(roles)('%s has a Total tile, and it is a roll-up', (role) => {
    const total = bucketsForRole(role).find((b) => b.key === 'total');
    expect(total, `${role} is missing a total bucket`).toBeDefined();
    expect(total.label).toBe('Total Queries');
    // It deliberately overlaps the status tiles, so exclusivity checks skip it.
    expect(total.aggregate).toBe(true);
  });

  it.each(roles)('%s Total is exactly the role scope, not a status slice', (role) => {
    const ctx = ctxFor(role);
    const total = bucketRecords(EVERY_STATE, role, 'total', ctx);
    const scoped = visibleQueries(EVERY_STATE, role, ctx);

    expect(total.map((q) => q.queryId)).toEqual(scoped.map((q) => q.queryId));
  });

  it.each(roles)('%s Total spans many workflow states', (role) => {
    const total = bucketRecords(EVERY_STATE, role, 'total', ctxFor(role));
    // The point of the tile: it is not pinned to one status.
    expect(new Set(total.map((q) => q.workflowState)).size).toBeGreaterThan(1);
  });

  it.each(roles)('%s Total is never smaller than any status tile', (role) => {
    const ctx = ctxFor(role);
    const total = bucketRecords(EVERY_STATE, role, 'total', ctx).length;

    for (const bucket of bucketsForRole(role).filter((b) => !b.aggregate)) {
      const count = bucketRecords(EVERY_STATE, role, bucket.key, ctx).length;
      expect(count, `${role} / ${bucket.label} exceeds Total`).toBeLessThanOrEqual(total);
    }
  });

  it.each(roles)('%s opens on a bucket that actually exists', (role) => {
    const keys = bucketsForRole(role).map((b) => b.key);
    expect(keys).toContain(defaultBucketKey(role));
  });

  it('lands on the actionable queue, not Total, for the working roles', () => {
    expect(defaultBucketKey(ROLES.FRONT_OFFICE)).toBe('incoming');
    expect(defaultBucketKey(ROLES.OFFICER_IN_CHARGE)).toBe('awaitingAssignment');
    expect(defaultBucketKey(ROLES.ASSIGNED_OFFICIAL)).toBe('assigned');
    expect(defaultBucketKey(ROLES.REVIEWER)).toBe('awaitingReview');
    // These two have no queue of their own to land on.
    expect(defaultBucketKey(ROLES.INQUIRER)).toBe('total');
    expect(defaultBucketKey(ROLES.ADMIN)).toBe('total');
  });

  it('renders Total first everywhere, for consistency across dashboards', () => {
    for (const role of roles) {
      expect(bucketsForRole(role)[0].key, role).toBe('total');
    }
  });
});

describe('role visibility scoping', () => {
  const ctx = (user, extra = {}) => ({
    user,
    workflowSteps: stepsFor(EVERY_STATE, REVIEWER.id),
    reviews: [],
    ...extra,
  });

  it('an inquirer sees only their own queries', () => {
    const mine = queryInState(WORKFLOW_STATE.RECEIVED);
    const theirs = queryInState(WORKFLOW_STATE.RECEIVED, {
      queryId: 'QRY-OTHER',
      inquirer: { id: 'USR-9999', email: 'someone@else.example' },
    });

    const seen = visibleQueries([mine, theirs], ROLES.INQUIRER, ctx(INQUIRER));
    expect(seen.map((q) => q.queryId)).toEqual([mine.queryId]);
  });

  it('an assigned official sees only their own cases, in any state', () => {
    const mine = queryInState(WORKFLOW_STATE.CLOSED);
    const theirs = queryInState(WORKFLOW_STATE.DRAFTING, {
      queryId: 'QRY-THEIRS',
      currentAssigneeId: OTHER_OFFICIAL.id,
      currentWorkflowStepId: null,
    });

    const seen = visibleQueries([mine, theirs], ROLES.ASSIGNED_OFFICIAL, ctx(OFFICIAL));
    expect(seen.map((q) => q.queryId)).toEqual([mine.queryId]);
  });

  it('a reviewer sees only cases they hold a level on or have ruled on', () => {
    const onMyLevel = queryInState(WORKFLOW_STATE.UNDER_REVIEW, { queryId: 'QRY-MINE' });
    const ruledByMe = queryInState(WORKFLOW_STATE.CLOSED, {
      queryId: 'QRY-RULED',
      currentWorkflowStepId: null,
    });
    const untouched = queryInState(WORKFLOW_STATE.DRAFTING, {
      queryId: 'QRY-NOPE',
      currentWorkflowStepId: null,
    });

    const context = ctx(REVIEWER, {
      workflowSteps: [
        { stepId: onMyLevel.currentWorkflowStepId, queryId: 'QRY-MINE', assignedUserId: REVIEWER.id },
      ],
      reviews: [{ queryId: 'QRY-RULED', reviewerId: REVIEWER.id, decision: 'APPROVED' }],
    });

    const seen = visibleQueries([onMyLevel, ruledByMe, untouched], ROLES.REVIEWER, context);
    expect(seen.map((q) => q.queryId).sort()).toEqual(['QRY-MINE', 'QRY-RULED']);
  });

  it('front office and OIC see the whole system', () => {
    for (const role of [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE]) {
      expect(visibleQueries(EVERY_STATE, role, ctx(OFFICIAL))).toHaveLength(EVERY_STATE.length);
    }
  });
});

describe('buckets map onto the real workflow states', () => {
  const ctx = { user: OFFICIAL, workflowSteps: [], reviews: [] };

  const at = (role, key, context = ctx) =>
    bucketRecords(EVERY_STATE, role, key, context).map((q) => q.workflowState);

  it('front office incoming is what front office must verify', () => {
    expect(at(ROLES.FRONT_OFFICE, 'incoming').sort()).toEqual(
      [WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION, WORKFLOW_STATE.RECEIVED].sort(),
    );
    expect(at(ROLES.FRONT_OFFICE, 'awaitingDispatch')).toEqual([
      WORKFLOW_STATE.READY_FOR_DISPATCH,
    ]);
  });

  it('the OIC approval queue is exactly PENDING_FINAL_APPROVAL', () => {
    expect(at(ROLES.OFFICER_IN_CHARGE, 'awaitingFinalApproval')).toEqual([
      WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
    ]);
  });

  it("an official's completed bucket covers the finished states", () => {
    expect(at(ROLES.ASSIGNED_OFFICIAL, 'completed').sort()).toEqual(
      [
        WORKFLOW_STATE.READY_FOR_DISPATCH,
        WORKFLOW_STATE.DISPATCHED,
        WORKFLOW_STATE.CLOSED,
      ].sort(),
    );
  });

  it('inquirer buckets follow businessStatus, and Closed absorbs CANCELLED', () => {
    const inquirerCtx = { user: INQUIRER, workflowSteps: [], reviews: [] };
    expect(at(ROLES.INQUIRER, 'open', inquirerCtx)).toEqual([WORKFLOW_STATE.RECEIVED]);
    expect(at(ROLES.INQUIRER, 'closed', inquirerCtx).sort()).toEqual(
      [WORKFLOW_STATE.CANCELLED, WORKFLOW_STATE.CLOSED].sort(),
    );
    // Total is the roll-up and must equal everything the inquirer can see.
    expect(bucketRecords(EVERY_STATE, ROLES.INQUIRER, 'total', inquirerCtx)).toHaveLength(
      EVERY_STATE.length,
    );
  });

  it('inquirer Open + In Progress + Closed accounts for every one of their queries', () => {
    const inquirerCtx = { user: INQUIRER, workflowSteps: [], reviews: [] };
    const total =
      bucketRecords(EVERY_STATE, ROLES.INQUIRER, 'open', inquirerCtx).length +
      bucketRecords(EVERY_STATE, ROLES.INQUIRER, 'inProgress', inquirerCtx).length +
      bucketRecords(EVERY_STATE, ROLES.INQUIRER, 'closed', inquirerCtx).length;
    expect(total).toBe(EVERY_STATE.length);
  });

  it('businessStatus values used by the buckets are the real enum members', () => {
    for (const state of ALL_STATES) {
      expect(Object.values(BUSINESS_STATUS)).toContain(deriveBusinessStatus(state));
    }
  });
});

describe('list-page filters are built from the same buckets', () => {
  const ctx = { user: OFFICIAL, workflowSteps: [], reviews: [] };

  it('anyBucket unions the named buckets and keeps role scoping', () => {
    const drafting = EVERY_STATE.filter(
      anyBucket(ROLES.ASSIGNED_OFFICIAL, ['assigned', 'drafting', 'returned'], ctx),
    );
    expect(drafting.map((q) => q.workflowState).sort()).toEqual(
      [
        WORKFLOW_STATE.ASSIGNED,
        WORKFLOW_STATE.DRAFTING,
        WORKFLOW_STATE.RETURNED_FOR_REVISION,
      ].sort(),
    );

    // Another official's cases are excluded by the role scope, not by state.
    const foreign = EVERY_STATE.filter(
      anyBucket(ROLES.ASSIGNED_OFFICIAL, ['assigned', 'drafting', 'returned'], {
        ...ctx,
        user: OTHER_OFFICIAL,
      }),
    );
    expect(foreign).toHaveLength(0);
  });

  it('roleScope alone returns everything the role may see', () => {
    expect(EVERY_STATE.filter(roleScope(ROLES.FRONT_OFFICE, ctx))).toHaveLength(
      EVERY_STATE.length,
    );
    expect(EVERY_STATE.filter(roleScope(ROLES.ASSIGNED_OFFICIAL, { ...ctx, user: OTHER_OFFICIAL })))
      .toHaveLength(0);
  });

  it('an unknown bucket key yields nothing rather than everything', () => {
    expect(bucketRecords(EVERY_STATE, ROLES.FRONT_OFFICE, 'nope', ctx)).toEqual([]);
  });
});
