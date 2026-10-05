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
import { memoryDb as db } from './support/memoryDb.js';
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
