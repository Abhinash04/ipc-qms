import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/WorkflowStep.js', async () => ({
  WorkflowStep: (await import('./support/memoryDb.js')).memoryDb.model('WorkflowStep', { unique: ['stepId'] }),
}));
vi.mock('../models/Review.js', async () => ({
  Review: (await import('./support/memoryDb.js')).memoryDb.model('Review', { unique: ['reviewId'] }),
}));
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion', { unique: ['responseId'] }),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification', { unique: ['notificationId'] }),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', { unique: ['messageId'] }),
}));
vi.mock('../models/EmailThread.js', async () => ({
  EmailThread: (await import('./support/memoryDb.js')).memoryDb.model('EmailThread', { unique: ['threadId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { USERS } from '../constants/users.js';
import {
  QueryCase,
  WorkflowStep,
  Notification,
  EmailMessage,
  AuditEvent,
  QueryCounter,
} from '../models/index.js';

const CASE_A = 'QRY-2026-00001';
const CASE_B = 'QRY-2026-00002';

const caseRow = (queryId, overrides = {}) => ({
  queryId,
  subject: 'Dissolution limits',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'PENDING_ASSIGNMENT',
  businessStatus: 'OPEN',
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
});

const step = (stepId, queryId, overrides = {}) => ({
  stepId,
  queryId,
  stepType: 'DRAFTING',
  sequence: 1,
  assignedUserId: null,
  status: 'IN_PROGRESS',
  ...overrides,
});

const notice = (notificationId, queryId) => ({
  notificationId,
  queryId,
  recipientRole: 'OFFICER_IN_CHARGE',
  title: `${queryId} awaiting assignment`,
  message: `${queryId} is awaiting assignment.`,
  at: '2026-09-18T09:00:00.000Z',
});

const transferMessage = (messageId, queryId, body) => ({
  messageId,
  threadId: null,
  queryId,
  direction: 'OUTBOUND',
  emailType: 'TRANSFER_NOTIFICATION',
  to: ['neha.singh@ipc.example'],
  subject: `Query ${queryId} Transferred`,
  body,
  timestamp: '2026-09-18T09:00:00.000Z',
});

const persist = (body, role = ROLES.FRONT_OFFICE) =>
  request(app).post('/api/v1/queries/persist').set(authHeader(role)).send(body);

async function seedCase(queryId, extra = {}) {
  const res = await persist({ query: caseRow(queryId), ...extra });
  expect(res.status).toBe(200);
}

const storedCase = (queryId) => QueryCase.findOne({ queryId }).lean();
const storedStep = (stepId) => WorkflowStep.findOne({ stepId }).lean();

beforeEach(() => {
  memoryDb.reset();
});

describe('/api/v1/queries/persist — the revision a change was built on', () => {
  it('stamps a new case with revision 1', async () => {
    const res = await persist({ query: caseRow(CASE_A), baseRevision: 0 });

    expect(res.status).toBe(200);
    expect((await storedCase(CASE_A)).revision).toBe(1);
  });

  it('moves the revision on by one for a write built on the current one', async () => {
    await seedCase(CASE_A);

    const res = await persist({ query: caseRow(CASE_A, { priority: 'HIGH' }), baseRevision: 1 });

    expect(res.status).toBe(200);
    expect(await storedCase(CASE_A)).toMatchObject({ revision: 2, priority: 'HIGH' });
  });

  it('refuses a write built on an outdated revision, and writes nothing from it', async () => {
    await seedCase(CASE_A, { counters: { QRY: 1 } });
    await persist({ query: caseRow(CASE_A, { priority: 'HIGH' }), baseRevision: 1 });

    const res = await persist(
      {
        query: caseRow(CASE_A, { workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0004' }),
        baseRevision: 1,
        upsertSteps: [step('STEP-00001', CASE_A, { assignedUserId: 'USR-0004' })],
        addReviews: [
          {
            reviewId: 'REV-00001',
            queryId: CASE_A,
            stepId: 'STEP-00001',
            reviewerId: 'USR-0005',
            decision: 'APPROVED',
            at: '2026-09-18T10:00:00.000Z',
          },
        ],
        notification: notice('NOTIF-00001', CASE_A),
        addMessages: [transferMessage('MSG-00001', CASE_A, 'Assigned to Neha.')],
        counters: { QRY: 1, STEP: 1, REV: 1, NOTIF: 1, MSG: 1 },
        auditEvent: { auditId: 'AUD-00001', event: 'QUERY_ASSIGNED', queryId: CASE_A, details: 'Assigned to Neha.' },
      },
      ROLES.OFFICER_IN_CHARGE,
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'STALE_CASE', queryId: CASE_A });
    expect(await storedCase(CASE_A)).toMatchObject({
      revision: 2,
      workflowState: 'PENDING_ASSIGNMENT',
      priority: 'HIGH',
    });
    for (const name of ['WorkflowStep', 'Review', 'Notification', 'EmailMessage']) {
      expect(memoryDb.rows(name)).toEqual([]);
    }
    expect(await AuditEvent.find({ action: 'QUERY_ASSIGNED' }).lean()).toHaveLength(0);
    expect((await QueryCounter.findOne({ key: 'counters' }).lean()).value).toEqual({ QRY: 1 });
  });

  it('treats a case stored before revisions existed as revision 0', async () => {
    await QueryCase.create(caseRow(CASE_A));

    const first = await persist({ query: caseRow(CASE_A, { priority: 'HIGH' }), baseRevision: 0 });

    expect(first.status).toBe(200);
    expect((await storedCase(CASE_A)).revision).toBe(1);

    const again = await persist({ query: caseRow(CASE_A, { priority: 'LOW' }), baseRevision: 0 });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('STALE_CASE');
    expect((await storedCase(CASE_A)).priority).toBe('HIGH');
  });

  it('refuses to recreate a case the client last saw at a later revision', async () => {
    const res = await persist({ query: caseRow(CASE_A), baseRevision: 3 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'STALE_CASE', queryId: CASE_A });
    expect(memoryDb.rows('QueryCase')).toEqual([]);
  });

  it('counts a server-side write as a change to the case', async () => {
    await seedCase(CASE_A);

    const pulled = await request(app)
      .post(`/api/v1/queries/${CASE_A}/pullback`)
      .set(authHeader(ROLES.ADMIN))
      .send({ targetStage: 'RECEIVED', reason: 'x' });

    expect(pulled.status).toBe(200);
    expect((await storedCase(CASE_A)).revision).toBe(2);

    const res = await persist({ query: caseRow(CASE_A, { priority: 'HIGH' }), baseRevision: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_CASE');
    expect(await storedCase(CASE_A)).toMatchObject({ revision: 2, workflowState: 'RECEIVED' });
  });
});

describe('/api/v1/queries/persist — a record id that belongs to another case', () => {
  it('refuses a workflow step whose id belongs to another case, and keeps that step', async () => {
    await seedCase(CASE_A);
    await seedCase(CASE_B, { upsertSteps: [step('STEP-00001', CASE_B)] });

    const res = await persist({
      query: caseRow(CASE_A),
      baseRevision: 1,
      upsertSteps: [step('STEP-00001', CASE_A)],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ID_COLLISION', queryId: CASE_A });
    expect((await storedStep('STEP-00001')).queryId).toBe(CASE_B);
    expect((await storedCase(CASE_B)).revision).toBe(1);
    expect((await storedCase(CASE_A)).revision).toBe(1);
  });

  it('answers a Reviewer on the case with a conflict, not a refusal, for the same collision', async () => {
    const reviewer = USERS.find((user) => user.role === ROLES.REVIEWER);
    await seedCase(CASE_A, { upsertSteps: [step('STEP-00001', CASE_A)] });
    await seedCase(CASE_B, { upsertSteps: [step('STEP-00002', CASE_B, { assignedUserId: reviewer.id })] });

    const res = await persist(
      {
        query: caseRow(CASE_B),
        baseRevision: 1,
        upsertSteps: [step('STEP-00001', CASE_B, { assignedUserId: reviewer.id })],
      },
      ROLES.REVIEWER,
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ID_COLLISION', queryId: CASE_B });
    expect((await storedStep('STEP-00001')).queryId).toBe(CASE_A);
  });

  it('refuses a message whose id belongs to another case, and keeps the original', async () => {
    await seedCase(CASE_A);
    await seedCase(CASE_B, { addMessages: [transferMessage('MSG-00001', CASE_B, 'Transferred to Neha.')] });

    const res = await persist({
      query: caseRow(CASE_A),
      baseRevision: 1,
      addMessages: [transferMessage('MSG-00001', CASE_A, 'Transferred to Meera.')],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ID_COLLISION');
    expect(await EmailMessage.findOne({ messageId: 'MSG-00001' }).lean()).toMatchObject({
      queryId: CASE_B,
      body: 'Transferred to Neha.',
    });
  });

  it('refuses a notification whose id belongs to another case', async () => {
    await seedCase(CASE_A);
    await seedCase(CASE_B, { notification: notice('NOTIF-00001', CASE_B) });

    const res = await persist({
      query: caseRow(CASE_A),
      baseRevision: 1,
      notification: notice('NOTIF-00001', CASE_A),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ID_COLLISION');
    expect((await Notification.findOne({ notificationId: 'NOTIF-00001' }).lean()).queryId).toBe(CASE_B);
  });

  it('refuses to delete a workflow step that belongs to another case', async () => {
    await seedCase(CASE_A);
    await seedCase(CASE_B, { upsertSteps: [step('STEP-00001', CASE_B)] });

    const res = await persist({ query: caseRow(CASE_A), baseRevision: 1, deleteStepIds: ['STEP-00001'] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ID_COLLISION');
    expect(await storedStep('STEP-00001')).toMatchObject({ queryId: CASE_B });
  });

  it('answers a collision the fast check cannot see with a conflict, and moves nothing', async () => {
    await seedCase(CASE_A, { upsertSteps: [step('STEP-00001', CASE_A)] });
    await seedCase(CASE_B);

    const res = await persist({
      notification: notice('NOTIF-00001', CASE_A),
      upsertSteps: [step('STEP-00001', CASE_B)],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ID_COLLISION', queryId: null });
    expect((await storedStep('STEP-00001')).queryId).toBe(CASE_A);
  });
});
