import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', {
    unique: ['queryId'],
    uniqueWhenString: ['sourceMailboxMessageId'],
  }),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', {
    unique: ['messageId'],
    uniqueWhenString: ['sourceMessageId'],
  }),
}));
vi.mock('../models/EmailThread.js', async () => ({
  EmailThread: (await import('./support/memoryDb.js')).memoryDb.model('EmailThread'),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification'),
}));
vi.mock('../models/MailboxDecision.js', async () => ({
  MailboxDecision: (await import('./support/memoryDb.js')).memoryDb.model('MailboxDecision', {
    unique: ['mailboxMessageId'],
  }),
  DECISIONS: { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' },
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
import * as gemmaService from '../services/ai/gemmaService.js';
import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  MailboxDecision,
  AuditEvent,
} from '../models/index.js';

const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';

const CONFIGURED_INQUIRER = 'inquirer@test.invalid';

const incoming = (overrides = {}) => ({
  from: SENDER,
  to: 'front-office@test.invalid',
  subject: 'Dissolution limits for a modified-release tablet',
  body: 'Please clarify the applicable dissolution limits.',
  receivedAt: '2026-09-17T09:00:00.000Z',
  providerMessageId: 'msg-ravi-1',
  providerThreadId: 'thread-ravi-1',
  ...overrides,
});

const accept = (mailboxMessageId, body = incoming(), role = ROLES.FRONT_OFFICE) =>
  request(app)
    .post(`/api/v1/mailbox/messages/${mailboxMessageId}/accept`)
    .set(authHeader(role))
    .send(body);

const messagesOfType = (emailType) => EmailMessage.find({ emailType }).lean();

let ackSpy;
let forwardSpy;

beforeEach(() => {
  db.reset();
  ackSpy = vi.spyOn(emailService, 'sendAcknowledgement');
  forwardSpy = vi.spyOn(emailService, 'forwardToOfficerInCharge');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /mailbox/messages/:messageId/accept — an unseen message', () => {
  it('registers the case, acknowledges the sender and forwards, in one call', async () => {
    const res = await accept('msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      created: true,
      acknowledged: true,
      forwarded: true,
      errors: [],
    });
    expect(res.body.queryId).toMatch(/^QRY-\d{4}-\d{5}$/);
  });

  it('records the inquirer as whoever wrote in, not a configured address', async () => {
    const res = await accept('msg-ravi-1');
    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();

    expect(stored.inquirer).toMatchObject({ name: 'Ravi Kumar', email: SENDER_EMAIL });
    expect(JSON.stringify(stored)).not.toContain(CONFIGURED_INQUIRER);
  });

  it('leaves the case at PENDING_ASSIGNMENT once the forward is out', async () => {
    const res = await accept('msg-ravi-1');
    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();

    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
  });

  it('keeps a copy of the acknowledgement and of the forward', async () => {
    const res = await accept('msg-ravi-1');

    const [acknowledgement] = await messagesOfType('ACKNOWLEDGEMENT');
    expect(acknowledgement.queryId).toBe(res.body.queryId);
    expect(acknowledgement.to).toContain(SENDER_EMAIL);

    const [forward] = await messagesOfType('FORWARD');
    expect(forward.queryId).toBe(res.body.queryId);
  });

  it('records the decision that produced the case', async () => {
    const res = await accept('msg-ravi-1');
    const decision = await MailboxDecision.findOne({
      mailboxMessageId: 'msg-ravi-1',
    }).lean();

    expect(decision).toMatchObject({ decision: 'ACCEPTED', queryId: res.body.queryId });
  });

  it('addresses the forward to the Officer-in-Charge', async () => {
    await accept('msg-ravi-1');

    const [forward] = await messagesOfType('FORWARD');
    expect(forward.to).toContain('officer@test.invalid');
    expect(forward.to).not.toContain(SENDER_EMAIL);
  });

  it('writes the intake history in order, attributed to the acting officer', async () => {
    const res = await accept('msg-ravi-1');

    const history = (await AuditEvent.find({ queryId: res.body.queryId }).lean()).map(
      (event) => event.action,
    );

    expect(history).toEqual([
      'QUERY_RECEIVED',
      'QUERY_REGISTERED',
      'CASE_ASSOCIATED',
      'AI_SUMMARY_GENERATED',
      'ACKNOWLEDGEMENT_SENT',
      'QUERY_FORWARDED',
    ]);

    const registered = (await AuditEvent.find({ queryId: res.body.queryId }).lean()).find(
      (event) => event.action === 'QUERY_REGISTERED',
    );
    expect(registered.actorRole).toBe(ROLES.FRONT_OFFICE);
    expect(registered.actorId).toBeTruthy();
  });
});

describe('the AI summary', () => {
  it('is stored on the case, not only mailed', async () => {
    const res = await accept('msg-ravi-1');

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.aiSummary).toBeTruthy();
    expect(stored.aiSummary.text).toEqual(expect.any(String));
    expect(stored.aiSummary.generatedAt).toEqual(expect.any(String));
  });

  it('says when it is the deterministic fallback rather than the model', async () => {
    const res = await accept('msg-ravi-1');

    expect(res.body.aiSummaryStatus).toBe('FALLBACK');

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.aiSummary).toMatchObject({ status: 'FALLBACK', fallback: true, aiGenerated: false });
  });

  it('is generated once and handed to the forward, not computed twice', async () => {
    await accept('msg-ravi-1');

    expect(forwardSpy).toHaveBeenCalledWith(expect.objectContaining({ aiSummary: expect.any(Object) }));
    expect(
      (await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length,
    ).toBe(1);
  });

  it('keeps the case when generation throws, and records the failure', async () => {
    vi.spyOn(gemmaService, 'generateSummary').mockRejectedValue(new Error('Gemma unreachable'));

    const res = await accept('msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, aiSummaryStatus: 'FAILED' });
    expect(res.body.errors).toContainEqual({ step: 'aiSummary', error: 'Gemma unreachable' });

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
    expect(stored.aiSummary).toMatchObject({ status: 'FAILED', error: 'Gemma unreachable' });
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
  });

  it('re-attempts a failed summary on retry, without a second case or email', async () => {
    const failing = vi
      .spyOn(gemmaService, 'generateSummary')
      .mockRejectedValue(new Error('Gemma unreachable'));

    const first = await accept('msg-ravi-1');
    expect(first.body.aiSummaryStatus).toBe('FAILED');

    failing.mockRestore();

    const second = await accept('msg-ravi-1');

    expect(second.body.aiSummaryStatus).toBe('FALLBACK');
    const stored = await QueryCase.findOne({ queryId: first.body.queryId }).lean();
    expect(stored.aiSummary.status).toBe('FALLBACK');
    expect(await QueryCase.find({}).lean()).toHaveLength(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
    expect(ackSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-summarise a case that already has one', async () => {
    await accept('msg-ravi-1');
    const calls = (await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length;

    await accept('msg-ravi-1');

    expect((await AuditEvent.find({ action: 'AI_SUMMARY_GENERATED' }).lean()).length).toBe(calls);
  });
});

describe('Case ID numbering', () => {
  it('numbers cases sequentially from one, off the server-side counter', async () => {
    const first = await accept('msg-ravi-1');
    const second = await accept('msg-priya-1', incoming({ from: 'Priya <priya@lab.example>' }));

    expect(first.body.queryId).toMatch(/-00001$/);
    expect(second.body.queryId).toMatch(/-00002$/);

    const counter = await QueryCounter.findOne({ key: 'counters' }).lean();
    expect(counter.value.QRY).toBe(2);
  });
});

describe('accepting the same message twice', () => {
  it('answers from the record, without a second case or a second email', async () => {
    const first = await accept('msg-ravi-1');
    const second = await accept('msg-ravi-1');

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      queryId: first.body.queryId,
      created: false,
      alreadyDecided: true,
    });

    expect(await QueryCase.find({}).lean()).toHaveLength(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(forwardSpy).toHaveBeenCalledTimes(1);
  });
});

describe('two accepts of the same message at once', () => {
  it('opens one case, and sends one acknowledgement and one forward', async () => {
    const [first, second] = await Promise.all([
      accept('msg-ravi-1'),
      accept('msg-ravi-1'),
    ]);

    expect(await QueryCase.find({}).lean()).toHaveLength(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(forwardSpy).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.queryId).toBe(second.body.queryId);

    const history = (await AuditEvent.find({ queryId: first.body.queryId }).lean()).map((e) => e.action);
    expect(history.filter((action) => action === 'QUERY_REGISTERED')).toHaveLength(1);
    expect(history.filter((action) => action === 'CASE_ASSOCIATED')).toHaveLength(1);
  });
});

describe('a step that fails', () => {
  it('still creates and forwards the case when the acknowledgement fails', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, acknowledged: false, forwarded: true });
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ step: 'acknowledgement' }),
    );

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
  });

  it('marks an unconfirmed acknowledgement distinctly, and records none', async () => {
    ackSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );

    const res = await accept('msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(false);
    expect(res.body.errors).toContainEqual(
      expect.objectContaining({ step: 'acknowledgement', unconfirmed: true }),
    );
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(0);
  });

  it('does not mark an ordinary acknowledgement failure as unconfirmed', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('msg-ravi-1');

    const failure = res.body.errors.find((entry) => entry.step === 'acknowledgement');
    expect(failure.unconfirmed).toBeUndefined();
  });

  const sendFailures = async (queryId) =>
    (await AuditEvent.find({ queryId }).lean()).filter((event) => event.action === 'EMAIL_SEND_FAILED');

  it('audits an unconfirmed acknowledgement as possibly sent', async () => {
    ackSpy.mockRejectedValue(
      Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
        unconfirmed: true,
      }),
    );

    const res = await accept('msg-ravi-1');

    const [failure, ...more] = await sendFailures(res.body.queryId);
    expect(more).toHaveLength(0);
    expect(failure).toMatchObject({ result: 'failure', actorRole: ROLES.FRONT_OFFICE });
    expect(failure.details).toMatch(/may have been sent/);
    expect(failure.details).toMatch(/Sent folder/);
  });

  it('audits an ordinary acknowledgement failure as not sent', async () => {
    ackSpy.mockRejectedValue(new Error('SMTP refused the acknowledgement'));

    const res = await accept('msg-ravi-1');

    const [failure] = await sendFailures(res.body.queryId);
    expect(failure.error).toBe('SMTP refused the acknowledgement');
    expect(failure.details).toMatch(/could not be sent/);
    expect(failure.details).not.toMatch(/may have been sent/);
  });

  it('leaves the case where the manual forward button acts when the forward fails', async () => {
    forwardSpy.mockRejectedValue(new Error('the officer mailbox timed out'));

    const res = await accept('msg-ravi-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, acknowledged: true, forwarded: false });
    expect(res.body.errors).toContainEqual(expect.objectContaining({ step: 'forward' }));

    const stored = await QueryCase.findOne({ queryId: res.body.queryId }).lean();
    expect(stored.workflowState).toBe('FRONT_OFFICE_VERIFICATION');
    expect(await messagesOfType('FORWARD')).toHaveLength(0);
  });

  it('finishes the forward on a retry, without acknowledging a second time', async () => {
    forwardSpy.mockRejectedValueOnce(new Error('the officer mailbox timed out'));

    const first = await accept('msg-ravi-1');
    const second = await accept('msg-ravi-1');

    expect(second.body).toMatchObject({
      queryId: first.body.queryId,
      created: false,
      forwarded: true,
    });

    const stored = await QueryCase.findOne({ queryId: first.body.queryId }).lean();
    expect(stored.workflowState).toBe('PENDING_ASSIGNMENT');
    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(await messagesOfType('ACKNOWLEDGEMENT')).toHaveLength(1);
    expect(await messagesOfType('FORWARD')).toHaveLength(1);
  });
});

describe('POST /mailbox/messages/:messageId/accept — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app)
      .post('/api/v1/mailbox/messages/msg-ravi-1/accept')
      .send(incoming());

    expect(res.status).toBe(401);
  });

  it('is refused to every role except Front Office and Super Admin', async () => {
    const denied = [
      ROLES.REVIEWER,
      ROLES.OFFICER_IN_CHARGE,
      ROLES.ASSIGNED_OFFICIAL,
      ROLES.REVIEWER,
      ROLES.ADMIN,
    ];

    for (const role of denied) {
      const res = await accept('msg-ravi-1', incoming(), role);
      expect(res.status).toBe(403);
    }
    expect(await QueryCase.find({}).lean()).toHaveLength(0);
  });
});
