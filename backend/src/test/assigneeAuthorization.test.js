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
import authConfig from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import { USERS } from '../constants/users.js';
import { QueryCase } from '../models/index.js';

const CASE = 'QRY-2026-00001';
const byId = (id) => USERS.find((user) => user.id === id);
const OFFICIAL_A = byId('USR-0004');
const OFFICIAL_B = byId('USR-0009');
const REVIEWER = byId('USR-0005');
const SUPER_ADMIN = byId('USR-0008');

const caseRow = (overrides = {}) => ({
  queryId: CASE,
  subject: 'Dissolution limits',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'ASSIGNED',
  businessStatus: 'IN_PROGRESS',
  currentAssigneeId: OFFICIAL_A.id,
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
});

const step = (stepId, overrides = {}) => ({
  stepId,
  queryId: CASE,
  stepType: 'REVIEW',
  sequence: 2,
  assignedUserId: REVIEWER.id,
  status: 'PENDING',
  ...overrides,
});

const persistAs = (user, body) =>
  request(app)
    .post('/api/v1/queries/persist')
    .set({ Cookie: `${authConfig.COOKIE_NAME}=${signToken(user)}` })
    .send(body);

async function seed(query = {}, extra = {}) {
  const res = await persistAs(SUPER_ADMIN, { query: caseRow(query), ...extra });
  expect(res.status).toBe(200);
}

beforeEach(() => {
  memoryDb.reset();
});

describe('a transferred case belongs to the new assignee only', () => {
  it('refuses the previous assignee once the case is transferred, and lets the new one draft', async () => {
    await seed();

    const transfer = await persistAs(OFFICIAL_A, {
      query: caseRow({ currentAssigneeId: OFFICIAL_B.id }),
      baseRevision: 1,
    });
    expect(transfer.status).toBe(200);

    const drafting = { query: caseRow({ workflowState: 'DRAFTING', currentAssigneeId: OFFICIAL_B.id }), baseRevision: 2 };

    expect((await persistAs(OFFICIAL_A, drafting)).status).toBe(403);
    expect((await persistAs(OFFICIAL_B, drafting)).status).toBe(200);
    expect(await QueryCase.findOne({ queryId: CASE }).lean()).toMatchObject({
      workflowState: 'DRAFTING',
      currentAssigneeId: OFFICIAL_B.id,
    });
  });

  it('refuses a former assignee who still owns a step on the case', async () => {
    await seed(
      { currentAssigneeId: OFFICIAL_B.id },
      { upsertSteps: [step('STEP-00001', { stepType: 'DRAFT', sequence: 1, assignedUserId: OFFICIAL_A.id, status: 'COMPLETED' })] },
    );

    const withQuery = await persistAs(OFFICIAL_A, {
      query: caseRow({ workflowState: 'DRAFTING', currentAssigneeId: OFFICIAL_B.id }),
      baseRevision: 1,
    });
    expect(withQuery.status).toBe(403);
    expect(withQuery.body).toMatchObject({ error: 'Only the current assignee may change that case', queryIds: [CASE] });

    const withoutQuery = await persistAs(OFFICIAL_A, {
      addVersions: [{ responseId: 'RESP-00001', queryId: CASE, status: 'DRAFT', content: 'Draft text' }],
    });
    expect(withoutQuery.status).toBe(403);
  });
});

describe('transfer is only possible before drafting starts', () => {
  it.each([
    ['the assignee', OFFICIAL_A],
    ['the Super Admin', SUPER_ADMIN],
  ])('refuses %s transferring a case in DRAFTING', async (_label, actor) => {
    await seed({ workflowState: 'DRAFTING' });

    const res = await persistAs(actor, {
      query: caseRow({ workflowState: 'DRAFTING', currentAssigneeId: OFFICIAL_B.id }),
      baseRevision: 1,
    });

    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(['query.currentAssigneeId']);
    expect((await QueryCase.findOne({ queryId: CASE }).lean()).currentAssigneeId).toBe(OFFICIAL_A.id);
  });

  it.each(['USR-0005', 'USR-0008', 'USR-9999'])('refuses a transfer to %s, who is not an Assigned Official', async (id) => {
    await seed();

    const res = await persistAs(OFFICIAL_A, { query: caseRow({ currentAssigneeId: id }), baseRevision: 1 });

    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(['query.currentAssigneeId']);
  });
});

