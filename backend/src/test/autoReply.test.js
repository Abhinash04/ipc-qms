import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
vi.mock('../models/MailboxMessage.js', async () => {
  const { memoryDb } = await import('./support/memoryDb.js');
  return {
    MailboxMessage: memoryDb.model('MailboxMessage', {
      unique: ['mailboxMessageId'],
      uniqueWhenString: ['providerMessageId'],
    }),
    Counter: memoryDb.model('Counter'),
  };
});
vi.mock('../models/MailboxTriage.js', async () => {
  const actual = await vi.importActual('../models/MailboxTriage.js');
  const { memoryDb } = await import('./support/memoryDb.js');
  return {
    ...actual,
    MailboxTriage: memoryDb.model('MailboxTriage', { unique: ['mailboxMessageId'] }),
  };
});
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
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion'),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification'),
}));

const browser = vi.hoisted(() => ({ sendMail: null }));
vi.mock('../services/email/nic/browser/sendMail.js', () => ({
  sendMail: (...args) => browser.sendMail(...args),
}));
import request from 'supertest';
import { memoryDb as db } from './support/memoryDb.js';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import { nicFrontOfficeUser } from '../constants/users.js';
import env from '../config/env.js';
import * as nicMailbox from '../services/email/mailbox/nicBrowserMailbox.js';
import { assess, assessPending, AUTO_REPLY_STATUS } from '../services/autoReply/assess.js';

const NIC_ADDRESS = 'nic-mailbox@test.invalid';
const INQUIRER = 'Ravi Kumar <ravi@pharma.example>';
const QUESTION = 'What is the use case of paracetamol?';

const read = (providerMessageId, overrides = {}) => ({
  providerMessageId,
  from: INQUIRER,
  to: [NIC_ADDRESS],
  cc: [],
  subject: `Enquiry ${providerMessageId}`,
  body: 'Please clarify the applicable dissolution limits.',
  receivedAt: '2026-09-18T09:00:00.000Z',
  attachments: [],
  ...overrides,
});
const asking = (providerMessageId, question = QUESTION) =>
  read(providerMessageId, { body: `Dear Sir/Madam,\n\n${question}\n\nRegards,\nRavi Kumar` });

const cookieFor = (user) => ({ Cookie: `${authConfig.COOKIE_NAME}=${signToken(user)}` });

const syncWith = (...messages) => nicMailbox.sync(NIC_ADDRESS, { reader: async () => messages });
const stored = (providerMessageId) => db.rows('MailboxMessage').find((row) => row.providerMessageId === providerMessageId);
const audits = (action) => db.rows('AuditEvent').filter((row) => row.action === action);

beforeEach(() => {
  db.reset();
  nicMailbox.resetSyncState();
  vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
  vi.stubEnv('NIC_EMAIL', NIC_ADDRESS);
  vi.stubEnv('NIC_FRONT_OFFICE_NAME', 'IPC Front Office');
  vi.stubEnv('NIC_BROWSER_TEST_RECIPIENT', 'ravi@pharma.example');
  browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: null }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  env.AUTO_REPLY_ENABLED = true;
  env.AUTO_REPLY_CONFIDENCE_THRESHOLD = 1;
});

describe('assessing new mail for an automatic reply', () => {
  it('offers a reply, with its draft, to a mail asking a supported question', async () => {
    await syncWith(asking('row-1'));

    expect(stored('row-1').autoReply).toMatchObject({
      status: AUTO_REPLY_STATUS.SUGGESTED,
      confidence: 1,
      threshold: 1,
      entryId: 'AR-PARACETAMOL-USE',
      question: QUESTION,
      matcher: 'mock-dataset-v1',
      draft: expect.stringMatching(/^Dear Sir\/Madam,\n\nParacetamol is a commonly used medicine/),
    });
    expect(audits('AUTO_REPLY_SUGGESTED')).toEqual([
      expect.objectContaining({
        actorType: 'system',
        messageId: stored('row-1').mailboxMessageId,
        details: expect.objectContaining({ entryId: 'AR-PARACETAMOL-USE', confidence: 1, threshold: 1 }),
      }),
    ]);
  });

  it('never sends anything on its own', async () => {
    await syncWith(asking('row-1'));

    expect(browser.sendMail).not.toHaveBeenCalled();
    expect(db.rows('OutboundEmail')).toEqual([]);
    expect(db.rows('QueryCase')).toEqual([]);
  });

  it('leaves every other mail to a person, with the reason', async () => {
    await syncWith(read('row-1'), asking('row-2', 'What is the main use case of paracetamol?'));

    expect(stored('row-1').autoReply).toMatchObject({ status: AUTO_REPLY_STATUS.NOT_ELIGIBLE });
    expect(stored('row-2').autoReply).toMatchObject({
      status: AUTO_REPLY_STATUS.NOT_ELIGIBLE,
      entryId: 'AR-PARACETAMOL-USE',
      topic: 'Uses of paracetamol',
      question: QUESTION,
      confidence: expect.any(Number),
    });
    expect(stored('row-2').autoReply.confidence).toBeGreaterThan(0.8);
    expect(stored('row-2').autoReply.confidence).toBeLessThan(1);
    expect(stored('row-2').autoReply.reason).toMatch(/below 100%/);
    expect(audits('AUTO_REPLY_SUGGESTED')).toEqual([]);
  });

  it('follows the configured threshold', async () => {
    env.AUTO_REPLY_CONFIDENCE_THRESHOLD = 0.8;
    await syncWith(asking('row-1', 'What is the main use case of paracetamol?'));

    expect(stored('row-1').autoReply).toMatchObject({ status: AUTO_REPLY_STATUS.SUGGESTED, threshold: 0.8 });
  });

  it('assesses each mail once', async () => {
    await syncWith(asking('row-1'));
    const id = stored('row-1').mailboxMessageId;
    await assess([id]);

    expect(audits('AUTO_REPLY_SUGGESTED')).toHaveLength(1);
  });

  it('does not offer a reply to a mail already accepted or rejected', async () => {
    env.AUTO_REPLY_ENABLED = false;
    await syncWith(asking('row-1'));
    const id = stored('row-1').mailboxMessageId;
    await db.model('MailboxDecision').create({ mailboxMessageId: id, decision: 'ACCEPTED' });

    env.AUTO_REPLY_ENABLED = true;
    await assessPending();

    expect(stored('row-1').autoReply).toMatchObject({
      status: AUTO_REPLY_STATUS.NOT_ELIGIBLE,
      reason: 'already handled through the standard workflow',
    });
  });

  it('assesses older mail in the backlog sweep', async () => {
    env.AUTO_REPLY_ENABLED = false;
    await syncWith(asking('row-1'));
    expect(stored('row-1').autoReply ?? null).toBeNull();

    env.AUTO_REPLY_ENABLED = true;
    expect(await assessPending()).toEqual({ suggested: 1, notEligible: 0 });
    expect(stored('row-1').autoReply.status).toBe(AUTO_REPLY_STATUS.SUGGESTED);
  });

  it('does nothing when auto-reply is switched off', async () => {
    env.AUTO_REPLY_ENABLED = false;
    await syncWith(asking('row-1'));

    expect(stored('row-1').autoReply ?? null).toBeNull();
    expect(audits('AUTO_REPLY_SUGGESTED')).toEqual([]);
  });
});

describe('the mailbox buckets', () => {
  const listing = (query = {}) =>
    request(app)
      .get('/api/v1/mailbox/messages')
      .query({ limit: 50, ...query })
      .set(cookieFor(nicFrontOfficeUser()));
  const ids = (res) => res.body.messages.map((message) => message.providerMessageId).sort();

  beforeEach(async () => {
    await syncWith(asking('row-1'), read('row-2'), read('row-3'));
  });

  it('lists every mail under All Mails, as before', async () => {
    const res = await listing();
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(['row-1', 'row-2', 'row-3']);
    expect(await listing({ bucket: 'all' }).then(ids)).toEqual(['row-1', 'row-2', 'row-3']);
  });

  it('lists the mails offered a reply under Auto Reply, with their suggestion', async () => {
    const res = await listing({ bucket: 'auto_reply' });
    expect(ids(res)).toEqual(['row-1']);
    expect(res.body.messages[0].autoReply).toMatchObject({ status: 'SUGGESTED', entryId: 'AR-PARACETAMOL-USE' });
  });

  it('lists the rest under Human Intervention', async () => {
    expect(await listing({ bucket: 'human' }).then(ids)).toEqual(['row-2', 'row-3']);
  });

  it('counts each bucket, and the categories within the bucket shown', async () => {
    const res = await listing({ bucket: 'human' });
    expect(res.body.bucketCounts).toEqual({ all: 3, auto_reply: 1, human: 2 });
    expect(Object.values(res.body.categoryCounts).reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it('refuses an unknown bucket', async () => {
    expect((await listing({ bucket: 'everything' })).status).toBe(400);
  });

  it('returns the suggestion with the message itself', async () => {
    const id = stored('row-1').mailboxMessageId;
    const res = await request(app).get(`/api/v1/mailbox/messages/${id}`).set(cookieFor(nicFrontOfficeUser()));
    expect(res.body.autoReply).toMatchObject({ status: 'SUGGESTED', draft: expect.stringMatching(/^Dear Sir\/Madam/) });
  });
});

describe('accepting a mail offered an automatic reply', () => {
  const acceptAs = (id, user = nicFrontOfficeUser()) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/accept`).set(cookieFor(user)).send({});
  const retry = (id, user = nicFrontOfficeUser()) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/auto-reply/retry`).set(cookieFor(user)).send({});
  const decline = (id, reason) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/auto-reply/decline`).set(cookieFor(nicFrontOfficeUser())).send({ reason });
  const reject = (id) =>
    request(app)
      .post(`/api/v1/mailbox/messages/${id}/decision`)
      .set(cookieFor(nicFrontOfficeUser()))
      .send({ decision: 'REJECTED', reason: 'Not an IPC query' });
  const sentMail = () => browser.sendMail.mock.calls.map(([mail]) => mail);
  const isReply = (mail) => /^Re: /.test(mail.subject);

  let id;
  beforeEach(async () => {
    await syncWith(asking('row-1'));
    id = stored('row-1').mailboxMessageId;
  });

  it('acknowledges the inquirer and then sends the reply on its own, without forwarding to the OIC', async () => {
    const res = await acceptAs(id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      created: true,
      acknowledged: true,
      forwarded: false,
      autoReply: { sent: true },
      queryId: expect.stringMatching(/^QRY-\d{4}-\d{5}$/),
    });

    const mails = sentMail();
    expect(mails).toHaveLength(2);
    expect(mails.every((mail) => mail.to.includes('ravi@pharma.example'))).toBe(true);
    const reply = mails.find(isReply);
    expect(reply.subject).toBe(`Re: Enquiry row-1 [${res.body.queryId}]`);
    expect(reply.body).toContain('Paracetamol is a commonly used medicine');

    const [caseRow] = db.rows('QueryCase');
    expect(caseRow).toMatchObject({
      queryId: res.body.queryId,
      workflowState: 'CLOSED',
      businessStatus: 'CLOSED',
      autoReply: { entryId: 'AR-PARACETAMOL-USE', confidence: 1 },
    });
    expect(caseRow.aiSummary).toBeTruthy();
    expect(db.rows('ResponseVersion')).toEqual([
      expect.objectContaining({ queryId: res.body.queryId, status: 'FINAL_APPROVED', source: 'AUTO_REPLY', aiGenerated: true }),
    ]);
    expect(stored('row-1').autoReply).toMatchObject({ status: 'SENT', queryId: res.body.queryId });
  });

  it('leaves an end-to-end trail with the acknowledgement, the prepared reply and no forward', async () => {
    const { body } = await acceptAs(id);

    const trail = db
      .rows('AuditEvent')
      .filter((row) => row.queryId === body.queryId)
      .map((row) => row.action);
    expect(trail).toEqual(
      expect.arrayContaining(['QUERY_RECEIVED', 'QUERY_REGISTERED', 'AI_SUMMARY_GENERATED', 'AUTO_REPLY_PREPARED', 'RESPONSE_DISPATCHED', 'QUERY_CLOSED']),
    );
    expect(trail).not.toContain('QUERY_FORWARDED');
    expect(trail.indexOf('AUTO_REPLY_PREPARED')).toBeLessThan(trail.indexOf('RESPONSE_DISPATCHED'));

    const prepared = db.rows('AuditEvent').find((row) => row.action === 'AUTO_REPLY_PREPARED');
    expect(prepared).toMatchObject({
      actorType: 'agent',
      actorId: nicFrontOfficeUser().id,
      messageId: id,
      changes: { status: { from: 'FRONT_OFFICE_VERIFICATION', to: 'READY_FOR_DISPATCH' } },
      details: expect.objectContaining({ entryId: 'AR-PARACETAMOL-USE', confidence: 1 }),
    });
  });

  it('sends nothing more and forwards nothing when the mail is accepted again', async () => {
    const first = await acceptAs(id);
    const again = await acceptAs(id);

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ queryId: first.body.queryId, forwarded: false, autoReply: { sent: true, alreadySent: true } });
    expect(sentMail().filter(isReply)).toHaveLength(1);
    expect(db.rows('QueryCase')).toHaveLength(1);
    expect(db.rows('AuditEvent').map((row) => row.action)).not.toContain('QUERY_FORWARDED');
  });

  it('keeps a failed reply for a retry, never forwarding it, and sends it once on retry', async () => {
    browser.sendMail = vi.fn(async (mail) => {
      if (/^Re: /.test(mail.subject)) throw new Error('NICeMail refused the message');
      return { ok: true, providerMessageId: null };
    });
    const failed = await acceptAs(id);

    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ acknowledged: true, forwarded: false, autoReply: { sent: false, error: expect.stringMatching(/refused/) } });
    expect(stored('row-1').autoReply.status).toBe('FAILED');
    expect(db.rows('QueryCase')[0].workflowState).toBe('READY_FOR_DISPATCH');

    browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: null }));
    const retried = await retry(id);

    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ sent: true, queryId: failed.body.queryId });
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
    expect(db.rows('QueryCase')[0].workflowState).toBe('CLOSED');
    expect(db.rows('AuditEvent').map((row) => row.action)).not.toContain('QUERY_FORWARDED');
  });

  it('retries only a reply that failed, for the Front Office only', async () => {
    expect((await retry(id)).status).toBe(409);
    const officer = { id: 'USR-0003', role: 'OFFICER_IN_CHARGE', name: 'EduTR Zairza', email: 'oic@ipc.example' };
    expect((await retry(id, officer)).status).toBe(403);
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('runs the standard workflow for a mail below the threshold', async () => {
    vi.stubEnv('NIC_ALLOW_INTERNAL_FORWARD', 'true');
    await syncWith(asking('row-2', 'What is the main use case of paracetamol?'));
    const res = await acceptAs(stored('row-2').mailboxMessageId);

    expect(res.body).toMatchObject({ forwarded: true });
    expect(res.body.autoReply).toBeUndefined();
    expect(sentMail().filter(isReply)).toEqual([]);
    expect(db.rows('AuditEvent').map((row) => row.action)).toContain('QUERY_FORWARDED');
  });

  it('runs the standard workflow for a mail sent to Human Intervention', async () => {
    vi.stubEnv('NIC_ALLOW_INTERNAL_FORWARD', 'true');
    expect((await decline(id, 'Needs a pharmacist to answer')).status).toBe(200);
    expect(audits('AUTO_REPLY_DECLINED')).toEqual([
      expect.objectContaining({ actorType: 'human', messageId: id, details: expect.objectContaining({ reason: 'Needs a pharmacist to answer' }) }),
    ]);

    const res = await acceptAs(id);
    expect(res.body).toMatchObject({ forwarded: true });
    expect(sentMail().filter(isReply)).toEqual([]);
    expect(stored('row-1').autoReply.status).toBe('DECLINED');
  });

  it('withdraws the suggestion when the mail is rejected', async () => {
    expect((await reject(id)).status).toBe(200);
    expect(stored('row-1').autoReply.status).toBe('DECLINED');
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('refuses to reject a mail already answered by an automatic reply', async () => {
    await acceptAs(id);
    expect((await reject(id)).status).toBe(409);
  });
});
