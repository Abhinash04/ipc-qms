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
vi.mock('../models/OutboundEmail.js', async () => {
  const actual = await vi.importActual('../models/OutboundEmail.js');
  return { ...actual, OutboundEmail: (await import('./support/memoryDb.js')).memoryDb.model('OutboundEmail') };
});
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { USERS } from '../constants/users.js';
import { Review } from '../models/Review.js';

const CASE = 'QRY-2026-00003';
const OIC = USERS.find((u) => u.role === ROLES.OFFICER_IN_CHARGE);
const REASON = 'The response does not adequately address the regulatory clarification requested by the stakeholder.';

const caseRow = (overrides = {}) => ({
  queryId: CASE,
  subject: 'Regulatory clarification',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'PENDING_FINAL_APPROVAL',
  businessStatus: 'IN_PROGRESS',
  createdAt: '2026-10-03T09:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
  ...overrides,
});

const persist = (body, role) => request(app).post('/api/v1/queries/persist').set(authHeader(role)).send(body);

const rejection = (reviewId, version, at, overrides = {}) => ({
  reviewId,
  queryId: CASE,
  stepId: null,
  reviewerId: OIC.id,
  decision: 'REJECTED',
  comment: REASON,
  responseId: `RESP-${version}`,
  version,
  reviewerRole: 'ASSIGNED_OFFICIAL',
  workflowState: 'PENDING_FINAL_APPROVAL',
  at,
  ...overrides,
});

async function seed() {
  const res = await persist({ query: caseRow() }, ROLES.FRONT_OFFICE);
  expect(res.status).toBe(200);
}

async function reject(review, baseRevision, role = ROLES.OFFICER_IN_CHARGE) {
  return persist(
    {
      query: caseRow({ workflowState: 'RETURNED_FOR_REVISION' }),
      baseRevision,
      addReviews: [review],
      auditEvent: { auditId: `AUD-${review.reviewId}`, event: 'FINAL_APPROVAL_REJECTED', queryId: CASE, details: `Final approval rejected on ${review.version}: ${REASON}` },
    },
    role,
  );
}

const loadCase = async () => {
  const res = await request(app).get('/api/v1/queries').set(authHeader(ROLES.SUPER_ADMIN));
  expect(res.status).toBe(200);
  return res.body;
};

beforeEach(() => {
  memoryDb.reset();
});

describe('an OIC rejection is a persisted review record', () => {
  it('stores the reason, actor, version, stage and time, with the role taken from the session', async () => {
    await seed();
    const res = await reject(rejection('REV-00001', 'v6', '2026-10-03T12:48:00.000Z'), 1);

    expect(res.status).toBe(200);
    expect(await Review.findOne({ reviewId: 'REV-00001' }).lean()).toMatchObject({
      queryId: CASE,
      decision: 'REJECTED',
      comment: REASON,
      reviewerId: OIC.id,
      reviewerRole: ROLES.OFFICER_IN_CHARGE,
      version: 'v6',
      workflowState: 'PENDING_FINAL_APPROVAL',
      at: '2026-10-03T12:48:00.000Z',
    });
  });

  it('is returned by the API with the case, alongside the audit actor', async () => {
    await seed();
    await reject(rejection('REV-00001', 'v6', '2026-10-03T12:48:00.000Z'), 1);

    const body = await loadCase();
    expect(body.reviews.filter((r) => r.queryId === CASE)).toEqual([
      expect.objectContaining({ decision: 'REJECTED', comment: REASON, version: 'v6', reviewerRole: ROLES.OFFICER_IN_CHARGE }),
    ]);
    expect(body.auditEvents.find((e) => e.event === 'FINAL_APPROVAL_REJECTED')).toMatchObject({
      actorId: OIC.id,
      actorRole: ROLES.OFFICER_IN_CHARGE,
    });
  });

  it.each([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER, ROLES.FRONT_OFFICE, ROLES.ADMIN])(
    'refuses %s writing a rejection, which only the Officer-in-Charge may do',
    async (role) => {
      await seed();
      const res = await reject(rejection('REV-00001', 'v6', '2026-10-03T12:48:00.000Z'), 1, role);
      expect(res.status).toBe(403);
      expect(await Review.findOne({ reviewId: 'REV-00001' }).lean()).toBeNull();
    },
  );

  it('keeps a rejection distinct from a return for revision', async () => {
    await seed();
    await reject(rejection('REV-00001', 'v6', '2026-10-03T12:48:00.000Z'), 1);
    await persist(
      {
        query: caseRow({ workflowState: 'PENDING_FINAL_APPROVAL' }),
        baseRevision: 2,
      },
      ROLES.SUPER_ADMIN,
    );
    const back = await persist(
      {
        query: caseRow({ workflowState: 'RETURNED_FOR_REVISION' }),
        baseRevision: 3,
        addReviews: [rejection('REV-00002', 'v7', '2026-10-03T14:00:00.000Z', { decision: 'CHANGES_REQUESTED', comment: 'Shorten it.' })],
      },
      ROLES.OFFICER_IN_CHARGE,
    );
    expect(back.status).toBe(200);

    const decisions = (await loadCase()).reviews.filter((r) => r.queryId === CASE).map((r) => [r.reviewId, r.decision, r.version]);
    expect(decisions).toEqual([
      ['REV-00001', 'REJECTED', 'v6'],
      ['REV-00002', 'CHANGES_REQUESTED', 'v7'],
    ]);
  });

  it('survives a resubmission and later rejections — every round stays in the history', async () => {
    await seed();
    await reject(rejection('REV-00001', 'v6', '2026-10-03T12:48:00.000Z'), 1);

    const resubmitted = await persist(
      {
        query: caseRow({ workflowState: 'UNDER_REVIEW' }),
        baseRevision: 2,
        addVersions: [{ responseId: 'RESP-v7', queryId: CASE, version: 'v7', content: 'Revised.', status: 'SUBMITTED', respondsToReviewId: 'REV-00001', changeSummary: 'Clarification added.' }],
      },
      ROLES.SUPER_ADMIN,
    );
    expect(resubmitted.status).toBe(200);
    await persist({ query: caseRow({ workflowState: 'PENDING_FINAL_APPROVAL' }), baseRevision: 3 }, ROLES.SUPER_ADMIN);
    await reject(rejection('REV-00002', 'v7', '2026-10-03T16:00:00.000Z', { comment: 'Still incomplete.' }), 4);

    const reviews = (await loadCase()).reviews.filter((r) => r.queryId === CASE);
    expect(reviews.map((r) => [r.reviewId, r.version, r.comment])).toEqual([
      ['REV-00001', 'v6', REASON],
      ['REV-00002', 'v7', 'Still incomplete.'],
    ]);
  });
});
