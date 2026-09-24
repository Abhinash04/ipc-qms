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
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion'),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', { unique: ['messageId'] }),
}));
vi.mock('../models/EmailThread.js', async () => ({
  EmailThread: (await import('./support/memoryDb.js')).memoryDb.model('EmailThread'),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification'),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/WorkflowStep.js', async () => ({
  WorkflowStep: (await import('./support/memoryDb.js')).memoryDb.model('WorkflowStep'),
}));
vi.mock('../models/OutboundEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  OutboundEmail: (await import('./support/memoryDb.js')).memoryDb.model('OutboundEmail', {
    unique: ['dispatchKey'],
  }),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as emailService from '../services/email/emailService.js';
import { QueryCase, ResponseVersion, EmailMessage, AuditEvent, OutboundEmail } from '../models/index.js';

const QUERY_ID = 'QRY-2026-00001';
const INQUIRER = 'ravi@pharma.example';

const post = (path, body, role = ROLES.FRONT_OFFICE) =>
  request(app).post(`/api/v1/${path}`).set(authHeader(role)).send(body);

const retryAcknowledgement = (body = { queryId: QUERY_ID }) => post('emails/acknowledgement', body);
const retryResponse = (body = { queryId: QUERY_ID }) => post('emails/response', body);
const resolve = (body, role = ROLES.FRONT_OFFICE) =>
  post(`queries/${QUERY_ID}/outbound/resolve`, body, role);

const messagesOfType = (emailType) => EmailMessage.find({ queryId: QUERY_ID, emailType }).lean();
const ledger = (emailType) => OutboundEmail.findOne({ dispatchKey: `${emailType}:${QUERY_ID}` }).lean();

async function approvedCase() {
  await QueryCase.create({
    queryId: QUERY_ID,
    subject: 'Dissolution limits',
    inquirer: { id: null, name: 'Ravi Kumar', email: INQUIRER },
    workflowState: 'READY_FOR_DISPATCH',
    businessStatus: 'IN_PROGRESS',
    threadId: 'THREAD-2026-00001',
    createdAt: '2026-09-18T09:00:00.000Z',
  });

  await ResponseVersion.create({
    responseId: 'RESP-00002',
    queryId: QUERY_ID,
    version: 'v2',
    content: 'The applicable limit is stated in the current monograph.',
    status: 'FINAL_APPROVED',
    createdAt: '2026-09-18T09:30:00.000Z',
  });
}

let ackSpy;
let responseSpy;

beforeEach(async () => {
  memoryDb.reset();
  ackSpy = vi.spyOn(emailService, 'sendAcknowledgement');
  responseSpy = vi.spyOn(emailService, 'sendResponse');
  await approvedCase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /emails/acknowledgement — the case page retry', () => {
  it('sends once, and answers the second press from the record', async () => {
    const first = await retryAcknowledgement();
    const second = await retryAcknowledgement();

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ queryId: QUERY_ID, emailType: 'ACKNOWLEDGEMENT', outcome: 'SENT' });
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe('ALREADY_SENT');

    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
  });

  it('sends to the inquirer on the case, not to an address in the request', async () => {
    await retryAcknowledgement({ queryId: QUERY_ID, to: 'somebody-else@elsewhere.example' });

    expect(ackSpy.mock.calls[0][0]).toMatchObject({ to: INQUIRER });
    const [recorded] = await messagesOfType('ACKNOWLEDGEMENT');
    expect(recorded.to).toEqual([INQUIRER]);
  });

  it('refuses a request that names no case', async () => {
    const res = await retryAcknowledgement({ to: INQUIRER });

    expect(res.status).toBe(400);
    expect(ackSpy).not.toHaveBeenCalled();
  });

  it('is 503 and retryable when the mail server could not be reached', async () => {
    ackSpy.mockRejectedValue(Object.assign(new Error('SMTP refused the connection'), { delivery: 'NOT_SENT' }));

    const res = await retryAcknowledgement();

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ outcome: 'FAILED', retryable: true });
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(0);
    expect((await ledger('ACKNOWLEDGEMENT')).status).toBe('FAILED');
  });
});

describe('POST /emails/response — the Dispatch page retry', () => {
  it('sends the approved text, closes the case, and sends once', async () => {
    const first = await retryResponse();
    const second = await retryResponse();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(responseSpy).toHaveBeenCalledTimes(1);

    expect(responseSpy.mock.calls[0][0]).toMatchObject({
      to: INQUIRER,
      body: 'The applicable limit is stated in the current monograph.',
    });

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('CLOSED');
    expect(stored.businessStatus).toBe('CLOSED');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);
  });

  it('ignores a subject and body supplied by the caller', async () => {
    await retryResponse({ queryId: QUERY_ID, to: 'attacker@elsewhere.example', subject: 'Anything', body: 'Anything at all' });

    expect(responseSpy.mock.calls[0][0]).toMatchObject({
      to: INQUIRER,
      subject: `Re: Dissolution limits [${QUERY_ID}]`,
      body: 'The applicable limit is stated in the current monograph.',
    });
  });

  it('refuses a case that has not been approved', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'UNDER_REVIEW' } });

    const res = await retryResponse();

    expect(res.status).toBe(409);
    expect(responseSpy).not.toHaveBeenCalled();
  });

  it('keeps the case open when the send may have gone out', async () => {
    responseSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );

    const res = await retryResponse();

    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ outcome: 'UNCERTAIN', unconfirmed: true });
    expect((await QueryCase.findOne({ queryId: QUERY_ID }).lean()).workflowState).toBe('READY_FOR_DISPATCH');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(0);
  });

  it('refuses to retry while an earlier send may already have arrived', async () => {
    responseSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );
    await retryResponse();
    responseSpy.mockClear();

    const res = await retryResponse();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ outcome: 'BLOCKED_UNCERTAIN', unconfirmed: true });
    expect(res.body.error).toMatch(/Sent folder/);
    expect(responseSpy).not.toHaveBeenCalled();
  });
});

describe('POST /queries/:queryId/outbound/resolve', () => {
  beforeEach(async () => {
    responseSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail did not confirm the send'), { unconfirmed: true }),
    );
    await retryResponse();
    responseSpy.mockClear();
  });

  it('records a send the Front Office found in the Sent folder, and closes the case', async () => {
    const res = await resolve({ emailType: 'OUTGOING_RESPONSE', outcome: 'SENT' });

    expect(res.status).toBe(200);
    expect(res.body.dispatch).toMatchObject({ status: 'SENT' });

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('CLOSED');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);

    const history = (await AuditEvent.find({ queryId: QUERY_ID }).lean()).map((e) => e.action);
    expect(history).toContain('EMAIL_DELIVERY_CONFIRMED');
    expect(history).toContain('RESPONSE_DISPATCHED');

    expect(responseSpy).not.toHaveBeenCalled();
  });

  it('unlocks the retry when the Front Office found nothing in the Sent folder', async () => {
    await resolve({ emailType: 'OUTGOING_RESPONSE', outcome: 'NOT_SENT' });

    expect((await ledger('OUTGOING_RESPONSE')).status).toBe('FAILED');

    responseSpy.mockResolvedValue({
      from: 'Front Office <front-office@test.invalid>',
      to: [INQUIRER],
      subject: `Re: Dissolution limits [${QUERY_ID}]`,
      body: 'The applicable limit is stated in the current monograph.',
      transport: 'mock',
      sentAt: '2026-09-18T10:00:00.000Z',
      providerMessageId: 'mock-1',
    });

    const res = await retryResponse();

    expect(res.status).toBe(201);
    expect(responseSpy).toHaveBeenCalledTimes(1);
    expect((await QueryCase.findOne({ queryId: QUERY_ID }).lean()).workflowState).toBe('CLOSED');
  });

  it('is refused to a role that does not own the mailbox', async () => {
    const res = await resolve({ emailType: 'OUTGOING_RESPONSE', outcome: 'SENT' }, ROLES.ASSIGNED_OFFICIAL);

    expect(res.status).toBe(403);
    expect((await ledger('OUTGOING_RESPONSE')).status).toBe('UNCERTAIN');
  });

  it('rejects an outcome it does not understand', async () => {
    const res = await resolve({ emailType: 'OUTGOING_RESPONSE', outcome: 'PROBABLY' });

    expect(res.status).toBe(400);
  });
});
