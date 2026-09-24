import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', { unique: ['messageId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { QueryCase, EmailMessage } from '../models/index.js';

const QUERY_ID = 'QRY-2026-00001';

const CASE = {
  queryId: QUERY_ID,
  subject: 'Dissolution limits',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'PENDING_ASSIGNMENT',
  businessStatus: 'OPEN',
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
};

const persist = (body, role = ROLES.FRONT_OFFICE) =>
  request(app).post('/api/v1/queries/persist').set(authHeader(role)).send(body);

const stored = () => QueryCase.findOne({ queryId: QUERY_ID }).lean();

beforeEach(() => {
  memoryDb.reset();
});

describe('the inquirer is written once', () => {
  it('is stored when the case is created', async () => {
    await persist({ query: CASE });

    expect((await stored()).inquirer).toMatchObject({ email: 'ravi@pharma.example' });
  });

  it('is not changed by a later write', async () => {
    await persist({ query: CASE });

    const res = await persist(
      {
        query: { ...CASE, workflowState: 'ASSIGNED', inquirer: { id: null, name: 'Someone Else', email: 'elsewhere@example.com' } },
        baseRevision: 1,
      },
      ROLES.OFFICER_IN_CHARGE,
    );

    expect(res.status).toBe(200);
    const after = await stored();
    expect(after.workflowState).toBe('ASSIGNED');
    expect(after.inquirer.email).toBe('ravi@pharma.example');
  });

});

describe('closing a case is the server’s to do', () => {
  beforeEach(async () => {
    await persist({ query: { ...CASE, workflowState: 'READY_FOR_DISPATCH' } });
  });

  it('refuses a client write that marks the case dispatched', async () => {
    const res = await persist({ query: { ...CASE, workflowState: 'DISPATCHED' }, baseRevision: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/closed by the server/i);
    expect((await stored()).workflowState).toBe('READY_FOR_DISPATCH');
  });

  it('refuses a client write that closes the case', async () => {
    const res = await persist({ query: { ...CASE, workflowState: 'CLOSED', businessStatus: 'CLOSED' }, baseRevision: 1 });

    expect(res.status).toBe(409);
    expect((await stored()).businessStatus).not.toBe('CLOSED');
  });

  it('allows a write to a case the server has already closed', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED' } });

    const res = await persist({
      query: { ...CASE, workflowState: 'CLOSED', businessStatus: 'CLOSED', priority: 'HIGH' },
      baseRevision: 1,
    });

    expect(res.status).toBe(200);
    expect((await stored()).priority).toBe('HIGH');
  });

  it('allows an administrator to pull a closed case back', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED' } });

    const res = await persist(
      { query: { ...CASE, workflowState: 'DRAFTING', businessStatus: 'IN_PROGRESS' }, baseRevision: 1 },
      ROLES.SUPER_ADMIN,
    );

    expect(res.status).toBe(200);
    expect((await stored()).workflowState).toBe('DRAFTING');
  });
});

describe('outbound case emails are the server’s to record', () => {
  const outbound = (emailType) => ({
    messageId: `MSG-FAKE-${emailType}`,
    queryId: QUERY_ID,
    emailType,
    direction: 'OUTBOUND',
    to: ['ravi@pharma.example'],
    subject: 'Anything',
    body: 'Anything',
    timestamp: '2026-09-18T10:00:00.000Z',
  });

  it.each(['ACKNOWLEDGEMENT', 'FORWARD', 'OUTGOING_RESPONSE'])('refuses a client-written %s', async (emailType) => {
    const res = await persist({ query: CASE, addMessages: [outbound(emailType)] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/recorded by the server/i);
    expect(await EmailMessage.find({ queryId: QUERY_ID }).lean()).toHaveLength(0);
  });

  it('still accepts the inbound record of the enquiry itself', async () => {
    const res = await persist({
      query: CASE,
      addMessages: [{ ...outbound('INCOMING_QUERY'), direction: 'INBOUND', messageId: 'MSG-00001' }],
    });

    expect(res.status).toBe(200);
    expect(await EmailMessage.find({ queryId: QUERY_ID }).lean()).toHaveLength(1);
  });
});
