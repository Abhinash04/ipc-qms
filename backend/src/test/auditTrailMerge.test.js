import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

const db = vi.hoisted(() => {
  const collections = new Map();

  const matches = (row, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
      return (row[key] ?? null) === value;
    });

  const model = (name) => {
    const rows = [];
    collections.set(name, rows);

    return {
      rows,
      create: async (doc) => {
        rows.push({ ...doc });
        return { ...doc };
      },
      exists: async (filter) => (rows.some((row) => matches(row, filter)) ? { _id: 'x' } : null),
      insertMany: async (docs) => {
        rows.push(...docs.map((doc) => ({ ...doc })));
        return docs;
      },
      deleteMany: async (filter = {}) => {
        const keep = rows.filter((row) => !matches(row, filter));
        rows.splice(0, rows.length, ...keep);
        return { acknowledged: true };
      },
      deleteOne: async () => ({ acknowledged: true }),
      findOne: () => ({
        select: () => ({ lean: async () => null }),
        lean: async () => null,
      }),
      findOneAndUpdate: async () => null,
    };
  };

  return { model, reset: () => collections.forEach((rows) => rows.splice(0)) };
});

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/AuditEvent.js', () => ({ AuditEvent: db.model('AuditEvent') }));
vi.mock('../models/QueryCase.js', () => ({ QueryCase: db.model('QueryCase') }));
vi.mock('../models/WorkflowStep.js', () => ({ WorkflowStep: db.model('WorkflowStep') }));
vi.mock('../models/Review.js', () => ({ Review: db.model('Review') }));
vi.mock('../models/ResponseVersion.js', () => ({ ResponseVersion: db.model('ResponseVersion') }));
vi.mock('../models/Notification.js', () => ({ Notification: db.model('Notification') }));
vi.mock('../models/EmailMessage.js', () => ({ EmailMessage: db.model('EmailMessage') }));
vi.mock('../models/EmailThread.js', () => ({ EmailThread: db.model('EmailThread') }));
vi.mock('../models/QueryCounter.js', () => ({ QueryCounter: db.model('QueryCounter') }));
vi.mock('../models/OutboundEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  OutboundEmail: db.model('OutboundEmail'),
}));

import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AuditEvent } from '../models/index.js';

const EVENT = {
  auditId: 'AUD-00007',
  queryId: 'QRY-2026-00001',
  event: 'QUERY_ASSIGNED',
  at: '2026-09-18T09:00:00.000Z',
  details: 'Assigned to Neha.',
};

const persist = (auditEvent) =>
  request(app)
    .post('/api/v1/queries/persist')
    .set(authHeader(ROLES.OFFICER_IN_CHARGE))
    .send({ auditEvent });

const workflowRows = () => AuditEvent.rows.filter((row) => row.queryId);

beforeEach(() => {
  db.reset();
});

describe('POST /queries/persist — one row per event', () => {
  it('records an event it has not seen', async () => {
    await persist(EVENT);

    expect(workflowRows()).toHaveLength(1);
    expect(workflowRows()[0]).toMatchObject({
      auditId: 'AUD-00007',
      action: 'QUERY_ASSIGNED',
      actorRole: ROLES.OFFICER_IN_CHARGE,
    });
  });

  it('writes nothing more when the same delta is sent twice', async () => {
    await persist(EVENT);
    await persist(EVENT);

    expect(workflowRows()).toHaveLength(1);
  });

  it('keeps a different event that happens to carry the same id', async () => {
    await persist(EVENT);
    await persist({
      ...EVENT,
      event: 'REVIEW_COMPLETED',
      at: '2026-09-18T11:30:00.000Z',
      details: 'Reviewer I approved.',
    });

    const rows = workflowRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.action)).toEqual(['QUERY_ASSIGNED', 'REVIEW_COMPLETED']);
  });

  it('records an event with no id every time, since there is nothing to match on', async () => {
    const anonymous = { ...EVENT, auditId: undefined };

    await persist(anonymous);
    await persist(anonymous);

    expect(workflowRows()).toHaveLength(2);
  });
});

describe('POST /queries/reset — the history goes with the cases', () => {
  const reset = (body = {}) =>
    request(app).post('/api/v1/queries/reset').set(authHeader(ROLES.SUPER_ADMIN)).send(body);

  it('clears the audit rows of the cases it deletes', async () => {
    await AuditEvent.create({ action: 'QUERY_ASSIGNED', queryId: 'QRY-2026-00001' });
    await AuditEvent.create({ action: 'REVIEW_COMPLETED', queryId: 'QRY-2026-00002' });

    const res = await reset();

    expect(res.status).toBe(200);
    expect(AuditEvent.rows.filter((row) => row.queryId)).toHaveLength(0);
  });

  it('keeps the compliance trail — rows that belong to no case', async () => {
    await AuditEvent.create({ action: 'LOGIN_SUCCEEDED', queryId: null });
    await AuditEvent.create({ action: 'AUTHORIZATION_DENIED', queryId: null });
    await AuditEvent.create({ action: 'QUERY_ASSIGNED', queryId: 'QRY-2026-00001' });

    await reset();

    const actions = AuditEvent.rows.map((row) => row.action);
    expect(actions).toContain('LOGIN_SUCCEEDED');
    expect(actions).toContain('AUTHORIZATION_DENIED');
    expect(actions).not.toContain('QUERY_ASSIGNED');
  });

  it('records the reset itself, after clearing', async () => {
    await reset();

    expect(AuditEvent.rows.map((row) => row.action)).toContain('QUERY_STATE_RESET');
  });

  it('restores seeded history in the stored shape', async () => {
    await reset({ auditEvents: [EVENT] });

    const seeded = AuditEvent.rows.find((row) => row.auditId === 'AUD-00007');
    expect(seeded).toMatchObject({
      action: 'QUERY_ASSIGNED',
      timestamp: '2026-09-18T09:00:00.000Z',
      queryId: 'QRY-2026-00001',
      actorType: 'human',
    });
  });

  it('is refused to everyone but the Super Admin', async () => {
    const res = await request(app)
      .post('/api/v1/queries/reset')
      .set(authHeader(ROLES.OFFICER_IN_CHARGE))
      .send({});

    expect(res.status).toBe(403);
  });
});
