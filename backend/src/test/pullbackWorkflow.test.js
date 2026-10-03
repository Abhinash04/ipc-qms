import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter', { unique: ['key'] }),
}));
vi.mock('../models/WorkflowStep.js', async () => ({
  WorkflowStep: (await import('./support/memoryDb.js')).memoryDb.model('WorkflowStep', { unique: ['stepId'] }),
}));
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion'),
}));
vi.mock('../models/Review.js', async () => ({
  Review: (await import('./support/memoryDb.js')).memoryDb.model('Review'),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification', { unique: ['notificationId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage'),
}));
vi.mock('../models/EmailThread.js', async () => ({
  EmailThread: (await import('./support/memoryDb.js')).memoryDb.model('EmailThread'),
}));

import { memoryDb as db } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { QueryCase, WorkflowStep } from '../models/index.js';
import {
  PULLBACK_RANK,
  PullbackError,
  activeSteps,
  planPullback,
  pullBackQuery,
} from '../services/workflow/pullback.js';

const QUERY_ID = 'QRY-2026-00003';
const OIC = 'USR-0003';
const NEHA = 'USR-0004';
const AMIT = 'USR-0005';
const KAVITA = 'USR-0006';
const ADMIN = { id: 'USR-0008', name: 'System Administrator', role: ROLES.SUPER_ADMIN };
const T0 = '2026-09-30T08:00:00.000Z';
const NOW = Date.parse('2026-10-01T10:00:00.000Z');

const step = (stepId, stepType, sequence, assignedUserId, status, extra = {}) => ({
  stepId,
  queryId: QUERY_ID,
  stepType,
  sequence,
  assignedUserId,
  status,
  createdAt: T0,
  startedAt: status === 'PENDING' ? null : T0,
  completedAt: status === 'COMPLETED' ? T0 : null,
  ...extra,
});

const draft = () => step('STEP-00001', 'DRAFT', 1, NEHA, 'COMPLETED');
const r1 = (status) => step('STEP-00002', 'REVIEW', 2, AMIT, status);
const r2 = (status) => step('STEP-00003', 'REVIEW', 3, KAVITA, status);
const final = (status) => step('STEP-00004', 'FINAL_APPROVAL', 1000, OIC, status);

const SOURCES = {
  PENDING_ASSIGNMENT: { workflowState: 'PENDING_ASSIGNMENT', currentAssigneeId: null, steps: [] },
  ASSIGNED: { workflowState: 'ASSIGNED', currentAssigneeId: NEHA, actionDeadline: '2026-10-01T09:00:00.000Z', steps: [] },
  DRAFTING: { workflowState: 'DRAFTING', currentAssigneeId: NEHA, steps: [r1('PENDING')] },
  'UNDER_REVIEW@Reviewer I': {
    workflowState: 'UNDER_REVIEW',
    currentAssigneeId: NEHA,
    current: 'STEP-00002',
    steps: [draft(), r1('IN_PROGRESS'), r2('PENDING'), final('PENDING')],
  },
  'UNDER_REVIEW@Reviewer II': {
    workflowState: 'UNDER_REVIEW',
    currentAssigneeId: NEHA,
    current: 'STEP-00003',
    steps: [draft(), r1('COMPLETED'), r2('IN_PROGRESS'), final('PENDING')],
  },
  RETURNED_FOR_REVISION: {
    workflowState: 'RETURNED_FOR_REVISION',
    currentAssigneeId: NEHA,
    current: 'STEP-00002',
    steps: [draft(), r1('PENDING'), r2('PENDING'), final('PENDING')],
  },
  'PENDING_FINAL_APPROVAL (one reviewer)': {
    workflowState: 'PENDING_FINAL_APPROVAL',
    currentAssigneeId: NEHA,
    current: 'STEP-00004',
    steps: [draft(), r1('COMPLETED'), final('IN_PROGRESS')],
  },
  'PENDING_FINAL_APPROVAL (two reviewers)': {
    workflowState: 'PENDING_FINAL_APPROVAL',
    currentAssigneeId: NEHA,
    current: 'STEP-00004',
    steps: [draft(), r1('COMPLETED'), r2('COMPLETED'), final('IN_PROGRESS')],
  },
};

const STAGE_TARGETS = [
  'RECEIVED',
  'FRONT_OFFICE_VERIFICATION',
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'DRAFTING',
  'RETURNED_FOR_REVISION',
];
const PRE_ASSIGNMENT = ['RECEIVED', 'FRONT_OFFICE_VERIFICATION', 'PENDING_ASSIGNMENT'];

const VERSIONS = ['v1', 'v2', 'v3', 'v4'].map((version, index) => ({
  responseId: `RESP-0000${index + 1}`,
  queryId: QUERY_ID,
  version,
  content: `Draft ${version}`,
  status: 'DRAFT',
  createdAt: T0,
}));

async function seed(name) {
  const source = SOURCES[name];
  await QueryCase.create({
    queryId: QUERY_ID,
    subject: 'Assay of metformin tablets',
    workflowState: source.workflowState,
    businessStatus: 'IN_PROGRESS',
    currentAssigneeId: source.currentAssigneeId,
    currentWorkflowStepId: source.current ?? null,
    assignmentDecision: source.currentAssigneeId
      ? { assigneeId: NEHA, ranking: [{ userId: NEHA, matchPercent: 91 }] }
      : null,
    actionDeadline: source.actionDeadline ?? null,
    revision: 7,
    createdAt: T0,
  });
  for (const row of source.steps) await WorkflowStep.create(row);
  for (const row of VERSIONS) await db.model('ResponseVersion').create(row);
  await db.model('Review').create({
    reviewId: 'REV-00001',
    queryId: QUERY_ID,
    stepId: 'STEP-00002',
    reviewerId: AMIT,
    decision: 'APPROVED',
    version: 'v4',
    at: T0,
  });
}

const stored = () => db.rows('QueryCase').find((row) => row.queryId === QUERY_ID);
const steps = () => db.rows('WorkflowStep').filter((row) => row.queryId === QUERY_ID);
const cycleSteps = (cycle) => steps().filter((row) => (row.cycle ?? 0) === cycle).sort((a, b) => a.sequence - b.sequence);

function reviewTargets(name) {
  const source = SOURCES[name];
  const chain = source.steps.filter((row) => row.stepType === 'REVIEW');
  if (source.workflowState === 'PENDING_FINAL_APPROVAL') return chain;
  if (source.workflowState !== 'UNDER_REVIEW') return [];
  return chain.slice(0, chain.findIndex((row) => row.stepId === source.current));
}

const PAIRS = Object.keys(SOURCES).flatMap((name) => [
  ...STAGE_TARGETS.filter((target) => PULLBACK_RANK[target] < PULLBACK_RANK[SOURCES[name].workflowState]).map((target) => [
    name,
    target,
    null,
  ]),
  ...reviewTargets(name).map((level) => [name, 'UNDER_REVIEW', level.stepId]),
]);

beforeEach(() => {
  db.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pulling back from every stage to every earlier stage', () => {
  it('covers every source stage the workflow has before final approval', () => {
    expect(new Set(PAIRS.map(([name]) => name)).size).toBe(Object.keys(SOURCES).length);
    expect(PAIRS.length).toBeGreaterThan(30);
  });

  it.each(PAIRS)('%s → %s %s', async (name, targetStage, reviewStepId) => {
    await seed(name);
    const before = { versions: db.rows('ResponseVersion'), reviews: db.rows('Review'), steps: steps() };
    const source = SOURCES[name];

    const result = await pullBackQuery({
      queryId: QUERY_ID,
      targetStage,
      reviewStepId,
      reason: 'Requires correction',
      remarks: 'second look',
      actor: ADMIN,
      now: NOW,
    });

    const query = stored();
    expect(query).toMatchObject({
      workflowState: targetStage,
      businessStatus: targetStage === 'RECEIVED' ? 'OPEN' : 'IN_PROGRESS',
      reviewCycle: 1,
      revision: 8,
      currentAssigneeId: PRE_ASSIGNMENT.includes(targetStage) ? null : source.currentAssigneeId,
    });

    for (const old of before.steps) {
      const now = steps().find((row) => row.stepId === old.stepId);
      if (old.status === 'PENDING' || old.status === 'IN_PROGRESS') {
        expect(now).toMatchObject({ ...old, status: 'SUPERSEDED', supersededAt: '2026-10-01T10:00:00.000Z' });
      } else {
        expect(now).toEqual(old);
      }
    }

    const fresh = cycleSteps(1);
    if (targetStage === 'UNDER_REVIEW') {
      const chain = source.steps.filter((row) => row.stepType === 'REVIEW');
      const level = chain.findIndex((row) => row.stepId === reviewStepId);
      const freshChain = fresh.filter((row) => row.stepType === 'REVIEW');
      expect(freshChain.map((row) => row.assignedUserId)).toEqual(chain.map((row) => row.assignedUserId));
      freshChain.forEach((row, index) => {
        if (index < level) expect(row).toMatchObject({ status: 'COMPLETED', carriedOver: true, completedAt: T0 });
        else if (index === level) expect(row).toMatchObject({ status: 'IN_PROGRESS', carriedOver: false, startedAt: '2026-10-01T10:00:00.000Z' });
        else expect(row).toMatchObject({ status: 'PENDING', carriedOver: false, startedAt: null });
      });
      expect(fresh.find((row) => row.stepType === 'FINAL_APPROVAL')).toMatchObject({ status: 'PENDING', assignedUserId: OIC });
      expect(query.currentWorkflowStepId).toBe(freshChain[level].stepId);
      expect(fresh.every((row) => !before.steps.some((old) => old.stepId === row.stepId))).toBe(true);
    } else {
      expect(fresh).toEqual([]);
      expect(query.currentWorkflowStepId).toBeNull();
    }

    expect(db.rows('ResponseVersion')).toEqual(before.versions);
    expect(db.rows('Review')).toEqual(before.reviews);

    expect(query.pullbackHistory).toEqual([
      expect.objectContaining({
        fromStage: source.workflowState,
        toStage: targetStage,
        fromCycle: 0,
        toCycle: 1,
        reason: 'Requires correction',
        remarks: 'second look',
        pulledBackBy: 'USR-0008',
        previousAssigneeId: source.currentAssigneeId,
        newAssigneeId: query.currentAssigneeId,
      }),
    ]);

    const [event] = db.rows('AuditEvent').filter((row) => row.action === 'QUERY_PULLED_BACK');
    expect(event).toMatchObject({ queryId: QUERY_ID, actorId: 'USR-0008', actorRole: ROLES.SUPER_ADMIN });
    expect(event.details).toContain(`From: ${source.workflowState} | Pulled Back To: ${targetStage}`);
    expect(event.details).toContain('Review cycle: 0 → 1');

    expect(db.rows('Notification')).toEqual([
      expect.objectContaining({ notificationId: `NOTIF-PULLBACK-${QUERY_ID}-1`, queryId: QUERY_ID }),
    ]);
    expect(result.query.reviewCycle).toBe(1);
  });
});

describe('the assignment clock', () => {
  it('stops the auto-transfer clock when the query leaves the assignee', async () => {
    await seed('ASSIGNED');

    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'PENDING_ASSIGNMENT', reason: 'Wrong official', actor: ADMIN, now: NOW });

    expect(stored()).toMatchObject({ actionDeadline: null, currentAssigneeId: null });
  });

  it('starts a fresh initial assignment when pulled back to Assigned, keeping the AI ranking', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');

    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'ASSIGNED', reason: 'Redo', actor: ADMIN, now: NOW });

    expect(stored()).toMatchObject({
      assignedAt: '2026-10-01T10:00:00.000Z',
      transferType: 'INITIAL_ASSIGNMENT',
      autoTransferHeldIds: [NEHA],
      autoTransferRanking: [{ userId: NEHA, matchPercent: 91 }],
    });
  });
});

describe('what pull back refuses', () => {
  it.each(['READY_FOR_DISPATCH', 'DISPATCHED', 'CLOSED'])('refuses once the query is %s', async (state) => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: state } });
    const before = stored();

    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: 'DRAFTING', reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 409, code: 'PULLBACK_NOT_ALLOWED' });
    expect(stored()).toEqual(before);
    expect(db.rows('AuditEvent')).toEqual([]);
  });

  it.each([
    ['DRAFTING', 'DRAFTING'],
    ['DRAFTING', 'RETURNED_FOR_REVISION'],
    ['ASSIGNED', 'UNDER_REVIEW'],
    ['PENDING_ASSIGNMENT', 'PENDING_FINAL_APPROVAL'],
  ])('refuses %s → %s, which is not an earlier stage', async (source, target) => {
    await seed(source);
    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: target, reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TARGET' });
  });

  it('needs a review level to return to review', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 400, code: 'REVIEW_LEVEL_REQUIRED' });
  });

  it('refuses the level under review now, or a later one', async () => {
    await seed('UNDER_REVIEW@Reviewer I');
    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00002', reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a review level from an earlier cycle', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00003', reason: 'x', actor: ADMIN, now: NOW });
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'PENDING_FINAL_APPROVAL' } });

    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00002', reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 400, code: 'REVIEW_LEVEL_REQUIRED' });
  });

  it('refuses when somebody changed the case meanwhile, and leaves no stray steps', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    const findOne = QueryCase.findOne.bind(QueryCase);
    vi.spyOn(QueryCase, 'findOne').mockImplementation((filter) => {
      const query = findOne(filter);
      return { lean: async () => ({ ...(await query.lean()), revision: 6 }) };
    });

    await expect(
      pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00002', reason: 'x', actor: ADMIN, now: NOW }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_CASE' });
    expect(cycleSteps(1)).toEqual([]);
    expect(stored()).toMatchObject({ workflowState: 'PENDING_FINAL_APPROVAL', revision: 7 });
  });

  it('refuses a case that does not exist', async () => {
    await expect(
      pullBackQuery({ queryId: 'QRY-2026-09999', targetStage: 'DRAFTING', reason: 'x', actor: ADMIN }),
    ).rejects.toBeInstanceOf(PullbackError);
  });
});

describe('pulling back more than once', () => {
  it('opens a new cycle each time and keeps every earlier one intact', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');

    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00003', reason: 'first', actor: ADMIN, now: NOW });
    const cycleOne = cycleSteps(1);
    const resumed = stored().currentWorkflowStepId;
    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'PENDING_ASSIGNMENT', reason: 'second', actor: ADMIN, now: NOW + 1000 });

    expect(stored()).toMatchObject({ reviewCycle: 2, workflowState: 'PENDING_ASSIGNMENT', currentWorkflowStepId: null });
    expect(cycleSteps(0)).toHaveLength(4);
    expect(cycleSteps(1).find((row) => row.stepId === resumed)).toMatchObject({ status: 'SUPERSEDED' });
    expect(cycleSteps(1).filter((row) => row.status === 'COMPLETED')).toEqual(
      cycleOne.filter((row) => row.status === 'COMPLETED'),
    );
    expect(cycleSteps(2)).toEqual([]);
    expect(stored().pullbackHistory.map((row) => [row.fromCycle, row.toCycle])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(db.rows('Notification').map((row) => row.notificationId)).toEqual([
      `NOTIF-PULLBACK-${QUERY_ID}-1`,
      `NOTIF-PULLBACK-${QUERY_ID}-2`,
    ]);
  });

  it('mints step ids the client counter will not reuse', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    await db.model('QueryCounter').create({ key: 'counters', value: { STEP: 4 } });

    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00002', reason: 'x', actor: ADMIN, now: NOW });

    expect(cycleSteps(1).map((row) => row.stepId)).toEqual(['STEP-00005', 'STEP-00006', 'STEP-00007', 'STEP-00008']);
    expect(db.rows('QueryCounter')[0].value.STEP).toBe(8);
  });
});

describe('the active chain', () => {
  it('is only the steps of the case’s current cycle', () => {
    const query = { queryId: QUERY_ID, reviewCycle: 1 };
    const rows = [r1('COMPLETED'), { ...r2('PENDING'), cycle: 1, stepId: 'STEP-00009' }];
    expect(activeSteps(rows, query).map((row) => row.stepId)).toEqual(['STEP-00009']);
    expect(activeSteps(rows, { queryId: QUERY_ID }).map((row) => row.stepId)).toEqual(['STEP-00002']);
  });

  it('plans without touching storage', () => {
    const query = { queryId: QUERY_ID, workflowState: 'DRAFTING', currentAssigneeId: NEHA, reviewCycle: 0 };
    const plan = planPullback({ query, steps: [r1('PENDING')], targetStage: 'ASSIGNED', reason: 'x', actor: ADMIN, now: NOW });
    expect(plan.supersededStepIds).toEqual(['STEP-00002']);
    expect(plan.patch).toMatchObject({ workflowState: 'ASSIGNED', reviewCycle: 1, currentAssigneeId: NEHA });
  });
});

describe('POST /api/v1/queries/:queryId/pullback', () => {
  const pull = (body, role = ROLES.ADMIN) =>
    request(app).post(`/api/v1/queries/${QUERY_ID}/pullback`).set(authHeader(role)).send(body);

  it('pulls back for the Admin and the System Administrator, and says where the query went', async () => {
    for (const role of [ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
      db.reset();
      await seed('PENDING_FINAL_APPROVAL (two reviewers)');

      const res = await pull({ targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00003', reason: 'Requires additional review' }, role);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        queryId: QUERY_ID,
        targetStage: 'UNDER_REVIEW',
        reviewLevel: 'Reviewer II',
        reviewCycle: 1,
        currentAssigneeId: NEHA,
        message: `Query ${QUERY_ID} has been successfully pulled back to UNDER_REVIEW (Reviewer II).`,
      });
      expect(res.body.currentWorkflowStepId).toBe(stored().currentWorkflowStepId);
    }
  });

  it('answers a refusal with its reason, not a server error', async () => {
    await seed('DRAFTING');
    const res = await pull({ targetStage: 'UNDER_REVIEW', reason: 'x' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'INVALID_TARGET', queryId: QUERY_ID });
  });

  it('answers 404 for a case that does not exist', async () => {
    const res = await pull({ targetStage: 'DRAFTING', reason: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('client deltas after a pull back', () => {
  const persist = (body, role = ROLES.ASSIGNED_OFFICIAL) =>
    request(app).post('/api/v1/queries/persist').set(authHeader(role)).send(body);

  it('cannot delete a review level that belongs to an earlier cycle', async () => {
    await seed('DRAFTING');
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { reviewCycle: 1 } });
    await WorkflowStep.create(step('STEP-00010', 'REVIEW', 2, KAVITA, 'PENDING', { cycle: 1 }));

    const old = await persist({ query: { queryId: QUERY_ID, workflowState: 'DRAFTING' }, baseRevision: 7, deleteStepIds: ['STEP-00002'] });
    expect(old.status).toBe(403);

    const current = await persist({ query: { queryId: QUERY_ID, workflowState: 'DRAFTING' }, baseRevision: 7, deleteStepIds: ['STEP-00010'] });
    expect(current.status).toBe(200);
    expect(steps().map((row) => row.stepId)).toEqual(['STEP-00002']);
  });

  it('cannot move a case to another stage through a delta, even as an Admin', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    const res = await persist({ query: { queryId: QUERY_ID, workflowState: 'DRAFTING' }, baseRevision: 7 }, ROLES.ADMIN);
    expect(res.status).toBe(403);
    expect(stored().workflowState).toBe('PENDING_FINAL_APPROVAL');
  });

  it('never lets a client overwrite the review cycle or the pull-back history', async () => {
    await seed('DRAFTING');
    await pullBackQuery({ queryId: QUERY_ID, targetStage: 'ASSIGNED', reason: 'x', actor: ADMIN, now: NOW });

    const res = await persist({
      query: { queryId: QUERY_ID, workflowState: 'ASSIGNED', reviewCycle: 0, pullbackHistory: [] },
      baseRevision: 8,
    });

    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ reviewCycle: 1 });
    expect(stored().pullbackHistory).toHaveLength(1);
  });
});

describe('who may pull back', () => {
  const pull = (role, body) =>
    request(app).post(`/api/v1/queries/${QUERY_ID}/pullback`).set(authHeader(role)).send(body);

  const ACTORS = {
    [ROLES.FRONT_OFFICE]: 'USR-TEST-FO',
    [ROLES.OFFICER_IN_CHARGE]: OIC,
    [ROLES.ADMIN]: 'USR-0007',
    [ROLES.SUPER_ADMIN]: 'USR-0008',
  };

  it.each(Object.keys(ACTORS))('lets the %s pull back to a reviewer level, and records who did it', async (role) => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    const before = { versions: db.rows('ResponseVersion'), reviews: db.rows('Review') };

    const res = await pull(role, { targetStage: 'UNDER_REVIEW', reviewStepId: 'STEP-00003', reason: 'Requires additional review' });

    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ workflowState: 'UNDER_REVIEW', reviewCycle: 1, currentAssigneeId: NEHA });
    expect(stored().pullbackHistory).toEqual([
      expect.objectContaining({
        pulledBackBy: ACTORS[role],
        pulledBackByRole: role,
        fromStage: 'PENDING_FINAL_APPROVAL',
        toStage: 'UNDER_REVIEW',
        toReviewLevel: 'Reviewer II',
        pulledBackAt: expect.any(String),
      }),
    ]);
    const [event] = db.rows('AuditEvent').filter((row) => row.action === 'QUERY_PULLED_BACK');
    expect(event).toMatchObject({ actorId: ACTORS[role], actorRole: role, timestamp: expect.any(String) });
    expect(event.details).toContain('From: PENDING_FINAL_APPROVAL | Pulled Back To: UNDER_REVIEW (Reviewer II)');
    expect(event.details).toContain(`(${role}) | Reason: Requires additional review`);
    expect(db.rows('ResponseVersion')).toEqual(before.versions);
    expect(db.rows('Review')).toEqual(before.reviews);
  });

  it.each(Object.keys(ACTORS))('lets the %s send a query back for reassignment', async (role) => {
    await seed('UNDER_REVIEW@Reviewer II');

    const res = await pull(role, { targetStage: 'PENDING_ASSIGNMENT', reason: 'Query needs to be reassigned' });

    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ workflowState: 'PENDING_ASSIGNMENT', currentAssigneeId: null, currentWorkflowStepId: null });
    expect(cycleSteps(1)).toEqual([]);
  });

  it.each([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER])('refuses the %s, changes nothing, and records the denial', async (role) => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    const before = { query: stored(), steps: steps() };

    const res = await pull(role, { targetStage: 'PENDING_ASSIGNMENT', reason: 'x' });

    expect(res.status).toBe(403);
    expect(stored()).toEqual(before.query);
    expect(steps()).toEqual(before.steps);
    expect(db.rows('AuditEvent').map((row) => row.action)).toEqual(['AUTHORIZATION_DENIED']);
  });

  it('still refuses the new roles once the query is closed', async () => {
    await seed('PENDING_FINAL_APPROVAL (two reviewers)');
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'CLOSED' } });

    for (const role of [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE]) {
      const res = await pull(role, { targetStage: 'DRAFTING', reason: 'x' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PULLBACK_NOT_ALLOWED');
    }
  });
});
