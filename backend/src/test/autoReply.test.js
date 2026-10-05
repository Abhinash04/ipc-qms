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
    expect(stored('row-2').autoReply).toMatchObject({ status: AUTO_REPLY_STATUS.NOT_ELIGIBLE, entryId: 'AR-PARACETAMOL-USE' });
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

describe('the Front Office approving an automatic reply', () => {
  const approve = (id, body, user = nicFrontOfficeUser()) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/auto-reply/approve`).set(cookieFor(user)).send({ body });
  const decline = (id, reason) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/auto-reply/decline`).set(cookieFor(nicFrontOfficeUser())).send({ reason });
  const acceptAs = (id) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/accept`).set(cookieFor(nicFrontOfficeUser())).send({});
  const EDITED = 'Dear Sir/Madam,\n\nParacetamol relieves mild to moderate pain and reduces fever. Edited by the Front Office.';

  let id;
  beforeEach(async () => {
    await syncWith(asking('row-1'));
    id = stored('row-1').mailboxMessageId;
  });

  it('sends the Front Office’s own text to the sender, as the response of a case closed at once', async () => {
    const res = await approve(id, EDITED);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: true, queryId: expect.stringMatching(/^QRY-\d{4}-\d{5}$/) });

    expect(browser.sendMail).toHaveBeenCalledTimes(1);
    const [mail] = browser.sendMail.mock.calls[0];
    expect(mail.to).toEqual(['ravi@pharma.example']);
    expect(mail.subject).toBe(`Re: Enquiry row-1 [${res.body.queryId}]`);
    expect(mail.body).toContain('Edited by the Front Office.');

    const [caseRow] = db.rows('QueryCase');
    expect(caseRow).toMatchObject({
      queryId: res.body.queryId,
      workflowState: 'CLOSED',
      businessStatus: 'CLOSED',
      sourceMailboxMessageId: id,
      autoReply: { entryId: 'AR-PARACETAMOL-USE', confidence: 1 },
    });
    expect(db.rows('ResponseVersion')).toEqual([
      expect.objectContaining({ queryId: res.body.queryId, content: EDITED, status: 'FINAL_APPROVED', source: 'AUTO_REPLY' }),
    ]);
    expect(db.rows('MailboxDecision')).toEqual([expect.objectContaining({ mailboxMessageId: id, decision: 'ACCEPTED' })]);
    expect(stored('row-1').autoReply).toMatchObject({ status: 'SENT', queryId: res.body.queryId, approvedBody: EDITED });
  });

  it('leaves an end-to-end trail on the case, with no acknowledgement and no forward', async () => {
    const { body } = await approve(id, EDITED);

    const trail = db
      .rows('AuditEvent')
      .filter((row) => row.queryId === body.queryId)
      .map((row) => row.action);
    expect(trail).toEqual([
      'QUERY_RECEIVED',
      'QUERY_REGISTERED',
      'CASE_ASSOCIATED',
      'AUTO_REPLY_APPROVED',
      'RESPONSE_DISPATCHED',
      'QUERY_CLOSED',
    ]);
    const approved = db.rows('AuditEvent').find((row) => row.action === 'AUTO_REPLY_APPROVED');
    expect(approved).toMatchObject({
      actorType: 'human',
      actorId: nicFrontOfficeUser().id,
      messageId: id,
      changes: { status: { from: 'FRONT_OFFICE_VERIFICATION', to: 'READY_FOR_DISPATCH' } },
      details: expect.objectContaining({ entryId: 'AR-PARACETAMOL-USE', edited: true }),
    });
  });

  it('records an unedited approval as such', async () => {
    await approve(id, stored('row-1').autoReply.draft);
    expect(db.rows('AuditEvent').find((row) => row.action === 'AUTO_REPLY_APPROVED').details.edited).toBe(false);
  });

  it('sends once, however often it is approved', async () => {
    const first = await approve(id, EDITED);
    const again = await approve(id, 'Something else');

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ sent: true, alreadySent: true, queryId: first.body.queryId });
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
    expect(db.rows('QueryCase')).toHaveLength(1);
  });

  it('keeps a failed send ready to retry, and sends it once on retry', async () => {
    browser.sendMail = vi.fn(async () => {
      throw new Error('NICeMail refused the message');
    });
    const failed = await approve(id, EDITED);

    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ sent: false, error: expect.stringMatching(/refused/) });
    expect(stored('row-1').autoReply.status).toBe('FAILED');
    expect(db.rows('QueryCase')[0].workflowState).toBe('READY_FOR_DISPATCH');

    browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: null }));
    const retried = await approve(id, 'A different text, ignored on retry');

    expect(retried.body).toMatchObject({ sent: true, queryId: failed.body.queryId });
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
    expect(browser.sendMail.mock.calls[0][0].body).toContain('Edited by the Front Office.');
    expect(db.rows('QueryCase')).toHaveLength(1);
  });

  it('is for the Front Office only', async () => {
    const officer = { id: 'USR-0003', role: 'OFFICER_IN_CHARGE', name: 'EduTR Zairza', email: 'oic@ipc.example' };
    expect((await approve(id, EDITED, officer)).status).toBe(403);
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('refuses an empty reply', async () => {
    expect((await approve(id, '   ')).status).toBe(400);
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('refuses a mail that was not offered a reply', async () => {
    await syncWith(read('row-2'));
    const res = await approve(stored('row-2').mailboxMessageId, EDITED);

    expect(res.status).toBe(409);
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('sends a declined mail to Human Intervention, on the record', async () => {
    const res = await decline(id, 'Needs a pharmacist to answer');

    expect(res.status).toBe(200);
    expect(stored('row-1').autoReply).toMatchObject({ status: 'DECLINED', reason: 'Needs a pharmacist to answer' });
    expect(audits('AUTO_REPLY_DECLINED')).toEqual([
      expect.objectContaining({ actorType: 'human', messageId: id, details: expect.objectContaining({ reason: 'Needs a pharmacist to answer' }) }),
    ]);
    expect((await approve(id, EDITED)).status).toBe(409);
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('withdraws the suggestion when the mail is accepted through the standard workflow', async () => {
    const res = await acceptAs(id);

    expect(res.status).toBe(200);
    expect(stored('row-1').autoReply).toMatchObject({ status: 'DECLINED', reason: 'handled through the standard workflow' });
    expect((await approve(id, EDITED)).status).toBe(409);
  });

  it('withdraws the suggestion when the mail is rejected through the standard workflow', async () => {
    const res = await request(app)
      .post(`/api/v1/mailbox/messages/${id}/decision`)
      .set(cookieFor(nicFrontOfficeUser()))
      .send({ decision: 'REJECTED', reason: 'Not an IPC query' });

    expect(res.status).toBe(200);
    expect(stored('row-1').autoReply.status).toBe('DECLINED');
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('refuses the standard workflow for a mail answered by an automatic reply', async () => {
    await approve(id, EDITED);
    const res = await acceptAs(id);

    expect(res.status).toBe(409);
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
  });
});
