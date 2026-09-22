import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * Final approval, and the response that answers the inquirer.
 *
 * The subject here is the ordering. The Officer-in-Charge's decision must
 * survive a mail server being down, and the case must not read CLOSED unless a
 * response genuinely went out — those pull in opposite directions, which is why
 * the approval is written before the send and the closure after it.
 *
 * This is also where a 403 used to live: the browser recorded the approval and
 * then called `/emails/response` itself, from the approving officer's session,
 * against an endpoint only the Front Office may use. The permission is
 * unchanged; the work moved to something that already holds it.
 *
 * The rest of the suite runs with DATABASE_URL blank and answers 503 before
 * reaching a model, so the models are stood in and the connection reported as
 * up — the same harness as acceptMessage.test.js.
 */

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

// The in-memory stand-in (support/memoryDb.js) enforces the unique keys the
// once-only send rests on — above all `dispatchKey` on the outbox ledger.
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion'),
}));
vi.mock('../models/WorkflowStep.js', async () => ({
  WorkflowStep: (await import('./support/memoryDb.js')).memoryDb.model('WorkflowStep'),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', { unique: ['messageId'] }),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification'),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/OutboundEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  OutboundEmail: (await import('./support/memoryDb.js')).memoryDb.model('OutboundEmail', {
    unique: ['dispatchKey'],
  }),
}));

import { memoryDb as db } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as emailService from '../services/email/emailService.js';
import env from '../config/env.js';
import {
  QueryCase,
  ResponseVersion,
  EmailMessage,
  AuditEvent,
  WorkflowStep,
  Notification,
} from '../models/index.js';

const QUERY_ID = 'QRY-2026-00001';

/** The person who actually wrote in. Never a configured address. */
const INQUIRER_EMAIL = 'ravi@pharma.example';

/** What vitest.config.mjs configures, so a test can prove it was NOT used. */
const CONFIGURED_INQUIRER = 'inquirer@test.invalid';

const approve = (queryId = QUERY_ID, role = ROLES.OFFICER_IN_CHARGE, body = {}) =>
  request(app)
    .post(`/api/v1/queries/${queryId}/final-approval`)
    .set(authHeader(role))
    .send(body);

/** A case that has been drafted, reviewed and is waiting on the OIC. */
async function caseAwaitingApproval(overrides = {}) {
  await QueryCase.create({
    queryId: QUERY_ID,
    subject: 'Dissolution limits for a modified-release tablet',
    inquirer: { id: null, name: 'Ravi Kumar', email: INQUIRER_EMAIL },
    workflowState: 'PENDING_FINAL_APPROVAL',
    businessStatus: 'IN_PROGRESS',
    threadId: 'THREAD-2026-00001',
    createdAt: '2026-09-17T09:00:00.000Z',
    ...overrides,
  });

  await ResponseVersion.create({
    responseId: 'RESP-00002',
    queryId: QUERY_ID,
    version: 'v2',
    content: 'The applicable limit is stated in the current monograph.',
    status: 'DRAFT',
    createdAt: '2026-09-17T10:00:00.000Z',
  });

  await WorkflowStep.create({
    stepId: 'STEP-00004',
    queryId: QUERY_ID,
    stepType: 'FINAL_APPROVAL',
    sequence: 4,
    status: 'IN_PROGRESS',
  });
}

const messagesOfType = (emailType) => EmailMessage.find({ emailType }).lean();
const actions = async () => (await AuditEvent.find({ queryId: QUERY_ID }).lean()).map((e) => e.action);

let sendSpy;

beforeEach(async () => {
  db.reset();
  // EMAIL_TRANSPORT=mock keeps real mail out of the suite; the spy is here for
  // the call counts and for the failure cases, which are the point of the file.
  sendSpy = vi.spyOn(emailService, 'sendResponse');
  await caseAwaitingApproval();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /queries/:queryId/final-approval — the happy path', () => {
  it('approves, sends the response and closes the case, in one call', async () => {
    const res = await approve();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      queryId: QUERY_ID,
      approved: true,
      dispatched: true,
      alreadyDispatched: false,
      workflowState: 'CLOSED',
      recipient: INQUIRER_EMAIL,
      errors: [],
    });
  });

  it('answers the person who wrote in, not a configured address', async () => {
    await approve();

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: INQUIRER_EMAIL }));

    const [response] = await messagesOfType('OUTGOING_RESPONSE');
    expect(response.to).toContain(INQUIRER_EMAIL);
    expect(JSON.stringify(response)).not.toContain(CONFIGURED_INQUIRER);
  });

  it('sends the approved text, and locks the version it sent', async () => {
    await approve();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'The applicable limit is stated in the current monograph.' }),
    );

    const version = await ResponseVersion.findOne({ responseId: 'RESP-00002' }).lean();
    expect(version.status).toBe('FINAL_APPROVED');
    expect(version.approvedAt).toEqual(expect.any(String));
  });

  it('leaves the case CLOSED in the database, not merely reported as closed', async () => {
    await approve();

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('CLOSED');
    expect(stored.businessStatus).toBe('CLOSED');

    const step = await WorkflowStep.findOne({ stepId: 'STEP-00004' }).lean();
    expect(step.status).toBe('COMPLETED');
  });

  it('writes the closing history in order', async () => {
    await approve();

    expect(await actions()).toEqual([
      'FINAL_APPROVAL_GRANTED',
      'RESPONSE_DISPATCHED',
      'QUERY_CLOSED',
    ]);
  });

  it('attributes the approval to the officer in the session', async () => {
    await approve();

    const granted = (await AuditEvent.find({ queryId: QUERY_ID }).lean()).find(
      (event) => event.action === 'FINAL_APPROVAL_GRANTED',
    );
    expect(granted.actorRole).toBe(ROLES.OFFICER_IN_CHARGE);
    expect(granted.actorId).toBeTruthy();
  });
});

/**
 * The half of the contract that matters most: a case must never read CLOSED
 * when the inquirer has not been answered.
 */
/**
 * A NICeMail browser send pressed Send and saw no confirmation in time. The
 * response may be in the inquirer's inbox, or may not. That is the one failure
 * where the usual advice — retry — is exactly wrong, so it must read
 * differently everywhere a person would act on it.
 */
describe('when the send is unconfirmed', () => {
  beforeEach(() => {
    sendSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );
  });

  it('keeps the case open, because CLOSED means a send known to have happened', async () => {
    const res = await approve();

    expect(res.body).toMatchObject({ approved: true, dispatched: false, workflowState: 'READY_FOR_DISPATCH' });
    expect(res.body.errors).toContainEqual(expect.objectContaining({ step: 'dispatch', unconfirmed: true }));

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('READY_FOR_DISPATCH');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(0);
  });

  it('tells the Front Office to check the Sent folder, not to retry', async () => {
    await approve();

    const [notice] = await Notification.find({ queryId: QUERY_ID }).lean();
    expect(notice.title).toMatch(/may have been sent/);
    expect(notice.message).toMatch(/Sent folder before retrying/);
    expect(notice.message).not.toMatch(/Retry from the case/);
  });

  it('records the uncertainty against the case, not a plain failure', async () => {
    await approve();

    const failure = (await AuditEvent.find({ queryId: QUERY_ID }).lean()).find(
      (event) => event.action === 'EMAIL_SEND_FAILED',
    );
    expect(failure.details).toMatch(/may have been sent/);
  });
});

/**
 * The failure this whole path was rebuilt for.
 *
 * In a live test the Officer-in-Charge pressed Approve four times while the
 * first send hung for 22 seconds on a failing DNS lookup. Each request read
 * "no response recorded yet" and sent; the inquirer received the same answer
 * three times. Overlapping requests are the normal case for a slow send, not an
 * exotic one, so they are what these tests do.
 */
describe('when approve is pressed more than once', () => {
  it('sends one response for three overlapping requests', async () => {
    const [first, second, third] = await Promise.all([approve(), approve(), approve()]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);

    // One decision, one send, one closure — however many times it was asked for.
    const history = await actions();
    expect(history.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
    expect(history.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
    expect(history.filter((action) => action === 'QUERY_CLOSED')).toHaveLength(1);

    // And none of the three is told the case failed.
    for (const res of [first, second, third]) {
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(true);
      expect(res.body.errors).toEqual([]);
    }
    expect([first, second, third].filter((res) => res.body.dispatched)).toHaveLength(1);
  });

  it('answers a later press from the record, without sending again', async () => {
    await approve();

    const again = await approve();

    expect(again.body).toMatchObject({ approved: true, alreadyDispatched: true, workflowState: 'CLOSED' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);
  });

  /**
   * The send that failed finished last, so its "not emailed" answer was what
   * the officer saw for a case that had in fact been answered and closed. The
   * ledger is what the reply is read from now, so a losing request reports the
   * state of the email rather than the fate of its own attempt.
   */
  it('does not report a failure for a response another request sent', async () => {
    let attempt = 0;
    sendSpy.mockImplementation(async () => {
      attempt += 1;
      if (attempt > 1) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        from: 'Front Office <front-office@test.invalid>',
        to: [INQUIRER_EMAIL],
        subject: `Re: Dissolution limits for a modified-release tablet [${QUERY_ID}]`,
        body: 'The applicable limit is stated in the current monograph.',
        transport: 'mock',
        sentAt: '2026-09-18T10:00:00.000Z',
        providerMessageId: 'mock-1',
      };
    });

    const [a, b] = await Promise.all([approve(), approve()]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);
    for (const res of [a, b]) expect(res.body.errors).toEqual([]);
  });
});

describe('when the response cannot be sent', () => {
  beforeEach(() => {
    sendSpy.mockRejectedValue(new Error('SMTP unavailable'));
  });

  it('keeps the approval and refuses to close the case', async () => {
    const res = await approve();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      approved: true,
      dispatched: false,
      workflowState: 'READY_FOR_DISPATCH',
    });
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ step: 'dispatch', error: 'SMTP unavailable', outcome: 'FAILED', retryable: true }),
    );

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('READY_FOR_DISPATCH');
    expect(stored.businessStatus).not.toBe('CLOSED');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(0);
  });

  /**
   * The transport's own EMAIL_SEND_FAILED rows carry no queryId, so a failure
   * cannot be traced back to the case it belonged to. This one can.
   */
  it('records the failure against the case', async () => {
    await approve();

    const failure = (await AuditEvent.find({ queryId: QUERY_ID }).lean()).find(
      (event) => event.action === 'EMAIL_SEND_FAILED',
    );
    expect(failure).toBeTruthy();
    expect(failure.queryId).toBe(QUERY_ID);
    expect(failure.error).toBe('SMTP unavailable');
    expect(failure.result).toBe('failure');
  });

  it('completes on a retry, without approving twice', async () => {
    await approve();
    sendSpy.mockRestore();
    sendSpy = vi.spyOn(emailService, 'sendResponse');

    const retry = await approve();

    expect(retry.body).toMatchObject({ dispatched: true, workflowState: 'CLOSED' });
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);

    // The decision was taken once, so it is recorded once.
    const granted = (await actions()).filter((a) => a === 'FINAL_APPROVAL_GRANTED');
    expect(granted).toHaveLength(1);
  });
});

/**
 * `getTransport` falls back to the mock when a role holds no usable credential,
 * and the mock returns an ordinary success. That is deliberate — it is what
 * lets the mocked tail of a development workflow run — and it is exactly why
 * this path has to check: on a deployment configured for real mail, a mock
 * result means the Front Office credential is missing or revoked, and closing
 * the case on it would tell the officer an inquirer had been answered who had
 * not been.
 *
 * The suite runs with EMAIL_TRANSPORT=mock, where a mock result IS delivery, so
 * the deployment setting is flipped for these two cases and restored after.
 */
describe('when the transport quietly degrades to the mock', () => {
  const MOCK_RESULT = {
    transport: 'mock',
    providerMessageId: 'mock-msg-1',
    to: INQUIRER_EMAIL,
    from: 'Front Office <front-office@test.invalid>',
    sentAt: '2026-09-17T12:00:00.000Z',
  };

  afterEach(() => {
    env.EMAIL_TRANSPORT = 'mock';
  });

  it('refuses to close the case when real mail was configured', async () => {
    env.EMAIL_TRANSPORT = 'gmail';
    sendSpy.mockResolvedValue(MOCK_RESULT);

    const res = await approve();

    expect(res.body).toMatchObject({
      approved: true,
      dispatched: false,
      workflowState: 'READY_FOR_DISPATCH',
    });
    expect(res.body.errors[0].error).toMatch(/no usable credential/i);

    const stored = await QueryCase.findOne({ queryId: QUERY_ID }).lean();
    expect(stored.workflowState).toBe('READY_FOR_DISPATCH');
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(0);
  });

  it('treats a mock result as delivery when mock is what was configured', async () => {
    env.EMAIL_TRANSPORT = 'mock';
    sendSpy.mockResolvedValue(MOCK_RESULT);

    const res = await approve();

    expect(res.body).toMatchObject({ dispatched: true, workflowState: 'CLOSED' });
  });
});

describe('approving twice', () => {
  it('answers from the stored response without emailing the inquirer again', async () => {
    await approve();
    const second = await approve();

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      approved: true,
      dispatched: false,
      alreadyDispatched: true,
      workflowState: 'CLOSED',
      recipient: INQUIRER_EMAIL,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('OUTGOING_RESPONSE')).toHaveLength(1);
  });
});

describe('a case that is not ready', () => {
  it('refuses a case that has not reached final approval', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { workflowState: 'DRAFTING' } });

    const res = await approve();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/DRAFTING/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses a case that does not exist', async () => {
    const res = await approve('QRY-2026-09999');

    expect(res.status).toBe(404);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('reports rather than sends when the case carries no inquirer address', async () => {
    await QueryCase.updateOne({ queryId: QUERY_ID }, { $set: { inquirer: { name: 'Nobody' } } });

    const res = await approve();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dispatched: false, workflowState: 'READY_FOR_DISPATCH' });
    expect(res.body.errors[0].step).toBe('dispatch');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

/**
 * DISPATCH remains a Front Office permission. What changed is who does the
 * sending, not who may.
 */
describe('POST /queries/:queryId/final-approval — authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await request(app).post(`/api/v1/queries/${QUERY_ID}/final-approval`).send({});
    expect(res.status).toBe(401);
  });

  it('refuses every role that may not grant final approval', async () => {
    for (const role of [
      ROLES.INQUIRER,
      ROLES.FRONT_OFFICE,
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.REVIEWER,
    ]) {
      const res = await approve(QUERY_ID, role);
      expect(res.status, `${role} should not be able to grant final approval`).toBe(403);
    }

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('admits the Officer-in-Charge and the Super Admin', async () => {
    expect((await approve(QUERY_ID, ROLES.OFFICER_IN_CHARGE)).status).toBe(200);

    db.reset();
    await caseAwaitingApproval();

    expect((await approve(QUERY_ID, ROLES.SUPER_ADMIN)).status).toBe(200);
  });
});
