import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

/**
 * What a client may not write about a case.
 *
 * `/queries/persist` takes case documents from the browser and `$set`s them, so
 * whatever it accepts is effectively client-controlled. Three things must not
 * be:
 *
 *   - **the inquirer** — it is read off the incoming email at intake and is
 *     where every reply goes. A stale tab that re-sent an older document could
 *     redirect the answer to a member of the public.
 *   - **DISPATCHED / CLOSED** — a case is closed when its response is known to
 *     have been sent, which only the server can know. The Dispatch page's retry
 *     used to close the case itself, after a send it had made.
 *   - **the outbound emails** — the acknowledgement, forward and response are
 *     recorded by the server when each is sent. A client-written record would
 *     both claim a send nobody made and, because the outbox adopts such a record
 *     as proof, stop the real one going out.
 */

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

    // The Officer-in-Charge: assigning is theirs (authorizeCaseDelta refuses
    // the Front Office a state it holds no action for).
    const res = await persist(
      {
        query: { ...CASE, workflowState: 'ASSIGNED', inquirer: { id: null, name: 'Someone Else', email: 'elsewhere@example.com' } },
      },
      ROLES.OFFICER_IN_CHARGE,
    );

    expect(res.status).toBe(200);
    const after = await stored();
    // The transition lands; the recipient does not move.
    expect(after.workflowState).toBe('ASSIGNED');
    expect(after.inquirer.email).toBe('ravi@pharma.example');
  });

  /**
   * An Inquirer's own portal enquiry: the inquirer is clamped to the session
   * identity, and still written once — on insert. Both rules used to write the
   * field, one in `$set` and one in `$setOnInsert`, which MongoDB refuses; every
   * portal enquiry would have failed.
   */
  it('is the signed-in Inquirer on their own portal enquiry, whatever the request names', async () => {
    const res = await persist(
      {
        query: {
          ...CASE,
          queryId: 'QRY-2026-00002',
          workflowState: 'RECEIVED',
          inquirer: { id: null, name: 'Forged', email: 'forged@example.com' },
        },
      },
      ROLES.INQUIRER,
    );

    expect(res.status).toBe(200);
    const created = await QueryCase.findOne({ queryId: 'QRY-2026-00002' }).lean();
    expect(created.inquirer.id).toBe('USR-0001');
    expect(created.inquirer.email).not.toBe('forged@example.com');
  });
});

describe('closing a case is the server’s to do', () => {
  beforeEach(async () => {
    await persist({ query: { ...CASE, workflowState: 'READY_FOR_DISPATCH' } });
  });

  it('refuses a client write that marks the case dispatched', async () => {
    const res = await persist({ query: { ...CASE, workflowState: 'DISPATCHED' } });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/closed by the server/i);
    expect((await stored()).workflowState).toBe('READY_FOR_DISPATCH');
  });

  it('refuses a client write that closes the case', async () => {
    const res = await persist({ query: { ...CASE, workflowState: 'CLOSED', businessStatus: 'CLOSED' } });

    expect(res.status).toBe(409);
    expect((await stored()).businessStatus).not.toBe('CLOSED');
  });

  /** A closed case still has to accept ordinary writes — a pullback moves it back out. */
  it('allows a write to a case the server has already closed', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED' } });

    const res = await persist({ query: { ...CASE, workflowState: 'CLOSED', businessStatus: 'CLOSED', priority: 'HIGH' } });

    expect(res.status).toBe(200);
    expect((await stored()).priority).toBe('HIGH');
  });

  it('allows an administrator to pull a closed case back', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED' } });

    const res = await persist(
      { query: { ...CASE, workflowState: 'DRAFTING', businessStatus: 'IN_PROGRESS' } },
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
