import { describe, it, expect, beforeEach } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { AUDIT_EVENT, WORKFLOW_STATE } from '@/constants/statusEnums';
import { getPullbackTargets } from '@/constants/pullbackRules';
import { historicalSteps } from '@/constants/reviewCycle';
import { reviewLevelName } from '@/constants/queryLifecycle';
import { fakeCaseMail } from '@/test/fakeCaseMail';
import { fakeFinalApprovalEndpoint } from '@/test/fakeFinalApprovalEndpoint';
import { fetchAllQueries } from '@/test/fakeQueryApi';

const s = () => useWorkflowStore.getState();

const OIC = findUserById('USR-0003');
const NEHA = findUserById('USR-0004');
const RAWAT = findUserById('USR-0009');
const AMIT = findUserById('USR-0005');
const KAVITA = findUserById('USR-0006');
const ADMIN = findUserById('USR-0007');

const {
  RECEIVED,
  FRONT_OFFICE_VERIFICATION,
  PENDING_ASSIGNMENT,
  ASSIGNED,
  DRAFTING,
  UNDER_REVIEW,
  RETURNED_FOR_REVISION,
  PENDING_FINAL_APPROVAL,
  CLOSED,
} = WORKFLOW_STATE;

const PRE_ASSIGNMENT = [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT];

let caseMail;
let queryId;

const query = () => s().getQuery(queryId);
const chain = () => s().getSteps(queryId).filter((step) => step.stepType === 'REVIEW');
const current = () => s().getCurrentStep(queryId);
const versions = () => s().getVersions(queryId).map((v) => v.version);
const history = () => historicalSteps(s().workflowSteps, query());
const events = () => s().getAudit(queryId).map((a) => a.event);

async function openCase() {
  await s().hydrate();
  await s().resetDemo();
  caseMail = fakeCaseMail();
  ({ queryId } = s().ingestEmail({
    mailboxMessageId: 'MSG-CYCLE-00001',
    to: 'ipc-query-mock@example.com',
    from: 'Anita Rao <anita.rao@pharma.example>',
    subject: 'Assay of metformin tablets',
    body: 'Please clarify the assay limits for metformin tablets in IP 2022.',
    receivedAt: '2026-09-28T09:00:00.000Z',
  }));
}

const drafterOf = () => findUserById(query().currentAssigneeId);

async function step({ drafter = NEHA, reviewers = [AMIT, KAVITA] } = {}) {
  const state = query().workflowState;
  if (state === RECEIVED) return s().verifyQuery(queryId, FRONT_OFFICE, caseMail.sendAcknowledgement);
  if (state === FRONT_OFFICE_VERIFICATION) return s().forwardToOic(queryId, FRONT_OFFICE, caseMail.forwardQuery);
  if (state === PENDING_ASSIGNMENT) return s().assignQuery(queryId, drafter.id, OIC);
  if (state === ASSIGNED) {
    return s().saveDraftVersion(queryId, `Response v${versions().length + 1}`, drafterOf());
  }
  if (state === DRAFTING || state === RETURNED_FOR_REVISION) {
    for (const reviewer of chain().length ? [] : reviewers) s().addReviewLevel(queryId, reviewer.id, drafterOf());
    return s().submitForReview(queryId, drafterOf());
  }
  if (state === UNDER_REVIEW) {
    return s().approveReview(queryId, 'Looks right.', findUserById(current().assignedUserId));
  }
  throw new Error(`no step defined from ${state}`);
}

async function advanceTo(target, options) {
  for (let guard = 0; query().workflowState !== target; guard += 1) {
    if (guard > 20) throw new Error(`stuck at ${query().workflowState} on the way to ${target}`);
    await step(options);
  }
}

const SOURCES = {
  [FRONT_OFFICE_VERIFICATION]: async () => advanceTo(FRONT_OFFICE_VERIFICATION),
  [PENDING_ASSIGNMENT]: async () => advanceTo(PENDING_ASSIGNMENT),
  [ASSIGNED]: async () => advanceTo(ASSIGNED),
  [DRAFTING]: async () => advanceTo(DRAFTING),
  'UNDER_REVIEW at Reviewer I': async () => advanceTo(UNDER_REVIEW),
  'UNDER_REVIEW at Reviewer II': async () => {
    await advanceTo(UNDER_REVIEW);
    await step();
  },
  [RETURNED_FOR_REVISION]: async () => {
    await advanceTo(UNDER_REVIEW);
    s().requestRevision(queryId, 'Cite the monograph.', AMIT);
  },
  [PENDING_FINAL_APPROVAL]: async () => advanceTo(PENDING_FINAL_APPROVAL),
};

const EXPECTED_TARGETS = {
  [FRONT_OFFICE_VERIFICATION]: [RECEIVED],
  [PENDING_ASSIGNMENT]: [RECEIVED, FRONT_OFFICE_VERIFICATION],
  [ASSIGNED]: [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT],
  [DRAFTING]: [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT, ASSIGNED],
  'UNDER_REVIEW at Reviewer I': [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT, ASSIGNED, DRAFTING],
  'UNDER_REVIEW at Reviewer II': [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT, ASSIGNED, DRAFTING, 'Reviewer I'],
  [RETURNED_FOR_REVISION]: [RECEIVED, FRONT_OFFICE_VERIFICATION, PENDING_ASSIGNMENT, ASSIGNED],
  [PENDING_FINAL_APPROVAL]: [
    RECEIVED,
    FRONT_OFFICE_VERIFICATION,
    PENDING_ASSIGNMENT,
    ASSIGNED,
    DRAFTING,
    'Reviewer I',
    'Reviewer II',
  ],
};

const describeTarget = (target) => {
  if (!target.reviewStepId) return target.stage;
  const level = chain().findIndex((row) => row.stepId === target.reviewStepId);
  return reviewLevelName(level);
};

const targetsNow = () => getPullbackTargets(query(), s().auditEvents, s().workflowSteps);

const pullBack = (target, actor = ADMIN) =>
  s().pullBackQuery(queryId, target.stage, 'Requires correction', '', actor, { reviewStepId: target.reviewStepId });

beforeEach(async () => {
  await openCase();
});

describe('the reported case: pulled back from final approval to Assign Query', () => {
  it('lets Neha set up a new review with the same Reviewer I and II, and the case completes', async () => {
    await advanceTo(DRAFTING);
    for (const n of [2, 3, 4]) s().saveDraftVersion(queryId, `Response v${n}`, NEHA);
    await advanceTo(PENDING_FINAL_APPROVAL);
    expect(versions()).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(chain().map((row) => row.status)).toEqual(['COMPLETED', 'COMPLETED']);

    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null });

    expect(query()).toMatchObject({
      workflowState: PENDING_ASSIGNMENT,
      currentAssigneeId: null,
      currentWorkflowStepId: null,
      reviewCycle: 1,
    });
    expect(chain()).toEqual([]);
    expect(history().map((row) => [row.stepType, row.assignedUserId, row.status])).toEqual([
      ['DRAFT', NEHA.id, 'COMPLETED'],
      ['REVIEW', AMIT.id, 'COMPLETED'],
      ['REVIEW', KAVITA.id, 'COMPLETED'],
      ['FINAL_APPROVAL', OIC.id, 'SUPERSEDED'],
    ]);

    const recommendation = s().recommendAssigneeFor(queryId);
    expect(recommendation?.userId).toEqual(expect.any(String));
    s().assignQuery(queryId, NEHA.id, OIC);
    expect(query()).toMatchObject({ workflowState: ASSIGNED, currentAssigneeId: NEHA.id });

    s().saveDraftVersion(queryId, 'Response v5', NEHA);
    s().saveDraftVersion(queryId, 'Response v6', NEHA);
    expect(versions()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);

    s().addReviewLevel(queryId, AMIT.id, NEHA);
    s().addReviewLevel(queryId, KAVITA.id, NEHA);
    expect(chain().map((row) => [row.assignedUserId, row.status, row.cycle])).toEqual([
      [AMIT.id, 'PENDING', 1],
      [KAVITA.id, 'PENDING', 1],
    ]);

    s().submitForReview(queryId, NEHA);
    expect(query().workflowState).toBe(UNDER_REVIEW);
    expect(current()).toMatchObject({ assignedUserId: AMIT.id, status: 'IN_PROGRESS', cycle: 1 });

    s().approveReview(queryId, 'Fine.', AMIT);
    expect(current()).toMatchObject({ assignedUserId: KAVITA.id, status: 'IN_PROGRESS' });
    s().approveReview(queryId, 'Fine.', KAVITA);
    expect(query().workflowState).toBe(PENDING_FINAL_APPROVAL);
    expect(current()).toMatchObject({ stepType: 'FINAL_APPROVAL', cycle: 1, status: 'IN_PROGRESS' });

    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());
    expect(query().workflowState).toBe(CLOSED);

    const stored = await fetchAllQueries();
    const oldFinal = stored.workflowSteps.find((row) => row.queryId === queryId && (row.cycle ?? 0) === 0 && row.stepType === 'FINAL_APPROVAL');
    expect(oldFinal.status).toBe('SUPERSEDED');
  });

  it('keeps every earlier version, review and audit entry, and records the new cycle in order', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    const before = { reviews: s().getReviews(queryId), versions: s().getVersions(queryId) };

    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null });
    s().assignQuery(queryId, NEHA.id, OIC);
    await advanceTo(PENDING_FINAL_APPROVAL);

    expect(s().getVersions(queryId).slice(0, before.versions.length)).toEqual(before.versions);
    expect(s().getReviews(queryId).slice(0, before.reviews.length)).toEqual(before.reviews);
    expect(s().getReviews(queryId)).toHaveLength(4);

    const trail = events();
    const pulled = trail.indexOf(AUDIT_EVENT.QUERY_PULLED_BACK);
    expect(pulled).toBeGreaterThan(trail.indexOf(AUDIT_EVENT.REVIEW_COMPLETED));
    expect(trail.slice(pulled)).toEqual(
      expect.arrayContaining([
        AUDIT_EVENT.QUERY_ASSIGNED,
        AUDIT_EVENT.DRAFT_UPDATED,
        AUDIT_EVENT.REVIEW_ADDED,
        AUDIT_EVENT.REVIEW_COMPLETED,
      ]),
    );
    const pullbackAudit = s().getAudit(queryId).find((a) => a.event === AUDIT_EVENT.QUERY_PULLED_BACK);
    expect(pullbackAudit.details).toContain('Review cycle: 0 → 1');
    expect(query().pullbackHistory).toEqual([
      expect.objectContaining({ fromStage: PENDING_FINAL_APPROVAL, toStage: PENDING_ASSIGNMENT, fromCycle: 0, toCycle: 1 }),
    ]);
  });

  it('accepts just one reviewer in the new cycle', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null });
    s().assignQuery(queryId, NEHA.id, OIC);

    await advanceTo(PENDING_FINAL_APPROVAL, { reviewers: [KAVITA] });

    expect(chain().map((row) => row.assignedUserId)).toEqual([KAVITA.id]);
    expect(s().getReviews(queryId).at(-1)).toMatchObject({ reviewerId: KAVITA.id, decision: 'APPROVED' });
  });

  it('accepts a reviewer who was not in the earlier chain', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL, { reviewers: [AMIT] });
    await pullBack({ stage: DRAFTING, reviewStepId: null });

    await advanceTo(PENDING_FINAL_APPROVAL, { reviewers: [KAVITA, AMIT] });

    expect(chain().map((row) => row.assignedUserId)).toEqual([KAVITA.id, AMIT.id]);
  });

  it('lets the OIC accept the AI recommendation again after the pull back', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null });

    const recommendation = s().recommendAssigneeFor(queryId);
    s().assignQuery(queryId, recommendation.userId, OIC);

    expect(query()).toMatchObject({
      currentAssigneeId: recommendation.userId,
      assignmentDecision: expect.objectContaining({ acceptedAiRecommendation: true }),
    });
    expect(events().slice(-2)).toEqual([AUDIT_EVENT.AI_ASSIGNMENT_RECOMMENDED, AUDIT_EVENT.QUERY_ASSIGNED]);
  });

  it('can hand the reworked query to a different official', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null });
    s().assignQuery(queryId, RAWAT.id, OIC);

    await advanceTo(PENDING_FINAL_APPROVAL);

    expect(s().getSteps(queryId).find((row) => row.stepType === 'DRAFT')).toMatchObject({ assignedUserId: RAWAT.id, cycle: 1 });
    expect(() => s().saveDraftVersion(queryId, 'x', NEHA)).toThrow();
  });
});

describe('resuming review at a chosen level', () => {
  it('returns from final approval to Reviewer II, keeping Reviewer I’s approval', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    const level = targetsNow().find((target) => target.reviewStepId && describeTarget(target) === 'Reviewer II');
    expect(level.label).toBe('Review / Action — Reviewer II (Kavita Rao)');

    await pullBack(level);

    expect(query()).toMatchObject({ workflowState: UNDER_REVIEW, currentAssigneeId: NEHA.id, reviewCycle: 1 });
    expect(chain().map((row) => [row.assignedUserId, row.status, Boolean(row.carriedOver)])).toEqual([
      [AMIT.id, 'COMPLETED', true],
      [KAVITA.id, 'IN_PROGRESS', false],
    ]);
    expect(current().assignedUserId).toBe(KAVITA.id);

    s().approveReview(queryId, 'Fine.', KAVITA);
    expect(query().workflowState).toBe(PENDING_FINAL_APPROVAL);
    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());
    expect(query().workflowState).toBe(CLOSED);
  });

  it('returns from Reviewer II to Reviewer I', async () => {
    await SOURCES['UNDER_REVIEW at Reviewer II']();
    const [level] = targetsNow().filter((target) => target.reviewStepId);

    await pullBack(level, ADMIN);

    expect(current()).toMatchObject({ assignedUserId: AMIT.id, status: 'IN_PROGRESS', cycle: 1 });
    expect(() => s().approveReview(queryId, 'x', KAVITA)).toThrow();
    await advanceTo(PENDING_FINAL_APPROVAL);
  });
});

describe('what the pull back dialog offers, and what it refuses', () => {
  it.each(Object.keys(SOURCES))('offers exactly the earlier stages from %s', async (source) => {
    await SOURCES[source]();
    expect(targetsNow().map(describeTarget)).toEqual(EXPECTED_TARGETS[source]);
  });

  it('offers nothing, and refuses, once the query is closed', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());

    expect(targetsNow()).toEqual([]);
    expect(() => pullBack({ stage: DRAFTING, reviewStepId: null })).toThrow(/finally approved or dispatched/);
  });

  it('refuses a role that may not pull back', async () => {
    await advanceTo(DRAFTING);
    for (const actor of [NEHA, AMIT]) {
      expect(() => pullBack({ stage: ASSIGNED, reviewStepId: null }, actor)).toThrow(/do not have permission/);
    }
  });

  it('reports a server refusal as a readable error', async () => {
    await advanceTo(DRAFTING);
    useWorkflowStore.setState({
      queries: s().queries.map((q) => (q.queryId === queryId ? { ...q, workflowState: PENDING_FINAL_APPROVAL } : q)),
    });

    await expect(pullBack({ stage: DRAFTING, reviewStepId: null })).rejects.toThrow(
      /cannot be pulled back from DRAFTING to DRAFTING/,
    );
    expect(query().workflowState).toBe(DRAFTING);
  });
});

const PAIRS = Object.entries(EXPECTED_TARGETS).flatMap(([source, targets]) => targets.map((target) => [source, target]));

describe('a full new cycle after every pull back', () => {
  it.each(PAIRS)('%s → %s', async (source, label) => {
    await SOURCES[source]();
    const target = targetsNow().find((entry) => describeTarget(entry) === label);
    const before = {
      versions: versions(),
      active: s().getSteps(queryId).map((row) => row.stepId),
      assignee: query().currentAssigneeId,
    };

    await pullBack(target);

    expect(query()).toMatchObject({ workflowState: target.stage, reviewCycle: 1 });
    expect(query().currentAssigneeId).toBe(PRE_ASSIGNMENT.includes(target.stage) ? null : before.assignee);
    expect(versions()).toEqual(before.versions);
    expect(history().map((row) => row.stepId)).toEqual(before.active);
    expect(history().every((row) => row.status !== 'PENDING' && row.status !== 'IN_PROGRESS')).toBe(true);
    if (target.reviewStepId) {
      expect(current()).toMatchObject({ status: 'IN_PROGRESS', cycle: 1 });
    } else {
      expect(s().getSteps(queryId)).toEqual([]);
      expect(query().currentWorkflowStepId).toBeNull();
    }

    await advanceTo(PENDING_FINAL_APPROVAL);
    expect(chain().every((row) => row.cycle === 1 && row.status === 'COMPLETED')).toBe(true);
    expect(current()).toMatchObject({ stepType: 'FINAL_APPROVAL', cycle: 1 });

    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());
    expect(query().workflowState).toBe(CLOSED);
  });
});

describe('the Front Officer and the OIC pull back too', () => {
  it('the Front Officer returns a query from final approval for reassignment, and it completes a new cycle', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);

    await pullBack({ stage: PENDING_ASSIGNMENT, reviewStepId: null }, FRONT_OFFICE);

    expect(query()).toMatchObject({ workflowState: PENDING_ASSIGNMENT, currentAssigneeId: null, reviewCycle: 1 });
    expect(query().pullbackHistory.at(-1)).toMatchObject({ pulledBackByRole: FRONT_OFFICE.role, toCycle: 1 });
    s().assignQuery(queryId, NEHA.id, OIC);
    await advanceTo(PENDING_FINAL_APPROVAL);
    expect(chain().map((row) => row.assignedUserId)).toEqual([AMIT.id, KAVITA.id]);
    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());
    expect(query().workflowState).toBe(CLOSED);
  });

  it('the OIC resumes review at Reviewer II, and the same reviewer approves again', async () => {
    await advanceTo(PENDING_FINAL_APPROVAL);
    const level = targetsNow().find((target) => target.reviewStepId && describeTarget(target) === 'Reviewer II');

    await pullBack(level, OIC);

    expect(current()).toMatchObject({ assignedUserId: KAVITA.id, status: 'IN_PROGRESS', cycle: 1 });
    const audit = s().getAudit(queryId).find((a) => a.event === AUDIT_EVENT.QUERY_PULLED_BACK);
    expect(audit.details).toContain(`(${OIC.role})`);
    s().approveReview(queryId, 'Fine.', KAVITA);
    expect(query().workflowState).toBe(PENDING_FINAL_APPROVAL);
  });
});
