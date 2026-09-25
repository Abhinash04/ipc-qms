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

const browser = vi.hoisted(() => ({ sendMail: null, readInbox: null }));
vi.mock('../services/email/nic/browser/sendMail.js', () => ({
  sendMail: (...args) => browser.sendMail(...args),
}));
vi.mock('../services/email/nic/browser/readInbox.js', () => ({
  readInbox: (...args) => browser.readInbox(...args),
}));

import { memoryDb as db } from './support/memoryDb.js';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import { ROLES } from '../constants/roles.js';
import { USERS, nicFrontOfficeUser } from '../constants/users.js';
import { TEST_FRONT_OFFICE } from './helpers/auth.js';
import * as nicMailbox from '../services/email/mailbox/nicBrowserMailbox.js';
import * as attachmentStore from '../services/attachments/attachmentStore.js';

const NIC_ADDRESS = 'nic-mailbox@test.invalid';
const ATT_A = 'att_11111111-2222-3333-4444-555555555555';
const ATT_B = 'att_66666666-7777-8888-9999-000000000000';

const cookieFor = (user) => ({ Cookie: `${authConfig.COOKIE_NAME}=${signToken(user)}` });
const nicUser = () => nicFrontOfficeUser();
const primaryUser = () => TEST_FRONT_OFFICE;
const superAdmin = () => USERS.find((user) => user.role === ROLES.SUPER_ADMIN);

const read = (providerMessageId, overrides = {}) => ({
  providerMessageId,
  providerThreadId: null,
  from: 'Ravi Kumar <ravi@pharma.example>',
  to: ['lab.ipc@example.invalid'],
  cc: [],
  bcc: [],
  subject: `Enquiry ${providerMessageId}`,
  body: 'Please clarify the applicable dissolution limits.',
  bodyHtml: '<p>Please clarify the applicable <b>dissolution</b> limits.</p>',
  unread: true,
  receivedAt: '2026-09-18T09:00:00.000Z',
  receivedAtSource: 'message',
  attachments: [],
  ...overrides,
});

const pdfEntry = (attachmentId) => ({ id: attachmentId, name: 'application.pdf', filename: 'application.pdf', mimeType: 'application/pdf', size: 20, sizeKb: 1, attachmentId });

async function seed() {
  await attachmentStore.saveWithId(ATT_A, {
    buffer: Buffer.from('%PDF-1.4 placeholder'),
    filename: 'application.pdf',
    mimeType: 'application/pdf',
    providerMessageId: 'row-2',
  });
  await attachmentStore.saveWithId(ATT_B, {
    buffer: Buffer.from('%PDF-1.4 other'),
    filename: 'other.pdf',
    mimeType: 'application/pdf',
    providerMessageId: 'row-x',
  });
  await nicMailbox.sync(NIC_ADDRESS, {
    reader: async () => [
      read('row-1', { subject: 'Labelling query', body: 'About labels.', receivedAt: '2026-09-18T08:00:00.000Z' }),
      read('row-2', { attachments: [pdfEntry(ATT_A)] }),
    ],
  });
  const [newer, older] = await nicMailbox.list(NIC_ADDRESS);
  return { newer, older };
}

const audits = (action) => db.rows('AuditEvent').filter((row) => row.action === action);

beforeEach(() => {
  db.reset();
  nicMailbox.resetSyncState();
  vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
  vi.stubEnv('NIC_EMAIL', NIC_ADDRESS);
  vi.stubEnv('NIC_FRONT_OFFICE_NAME', 'Eco-Clubs Front Office');
  vi.stubEnv('NIC_BROWSER_TEST_RECIPIENT', 'ravi@pharma.example');
  browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: null }));
  browser.readInbox = vi.fn(async () => ({ messages: [], failures: [], remaining: 0 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /mailbox/messages', () => {
  const list = (query = '', user = nicUser()) => request(app).get(`/api/v1/mailbox/messages${query}`).set(cookieFor(user));

  it('keeps every field it had and adds the view, without the HTML body', async () => {
    await seed();

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('total');
    const [first] = res.body.messages;
    expect(first).toMatchObject({
      subject: 'Enquiry row-2',
      from: 'Ravi Kumar <ravi@pharma.example>',
      to: NIC_ADDRESS,
      toAddresses: ['lab.ipc@example.invalid'],
      isRead: false,
      status: 'NEW',
      linkedCase: null,
      ingested: false,
    });
    expect(first).not.toHaveProperty('bodyHtml');
    expect(Date.parse(first.createdAt)).not.toBeNaN();
  });

  it('searches sender, subject and text, without regard to case', async () => {
    await seed();

    expect((await list('?q=LABELLING')).body.messages.map((m) => m.subject)).toEqual(['Labelling query']);
    expect((await list('?q=dissolution')).body.messages.map((m) => m.subject)).toEqual(['Enquiry row-2']);
    expect((await list('?q=pharma.example')).body.messages).toHaveLength(2);
  });

  it('searches for the text typed, not a pattern', async () => {
    await seed();

    expect((await list('?q=a.out')).body.messages).toEqual([]);
    expect((await list(`?q=${encodeURIComponent('(')}`)).status).toBe(200);
  });

  it('pages newest first and says how many there are', async () => {
    await seed();

    const first = await list('?limit=1');
    const second = await list('?limit=1&offset=1');

    expect(first.body).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(first.body.messages.map((m) => m.subject)).toEqual(['Enquiry row-2']);
    expect(second.body.messages.map((m) => m.subject)).toEqual(['Labelling query']);
  });

  it.each([['?limit=0'], ['?limit=500'], [`?q=${'x'.repeat(201)}`], ['?offset=-1'], ['?q=%00']])('refuses %s', async (query) => {
    expect((await list(query)).status).toBe(400);
  });

  it('shows the case a message became, with its status', async () => {
    const { newer } = await seed();
    const accepted = await request(app)
      .post(`/api/v1/mailbox/messages/${newer.mailboxMessageId}/accept`)
      .set(cookieFor(nicUser()))
      .send({});

    const [first] = (await list()).body.messages;

    expect(first).toMatchObject({
      status: 'ACCEPTED',
      linkedCase: { queryId: accepted.body.queryId, workflowState: expect.any(String), businessStatus: expect.any(String) },
    });
  });

  it('searches and pages the primary mailbox too, which keeps no read state', async () => {
    for (const subject of ['First', 'Second', 'Third']) {
      await request(app)
        .post('/api/v1/mailbox/receive')
        .set(cookieFor(superAdmin()))
        .send({ from: 'someone@example.invalid', subject, body: 'Body text.' });
    }

    const res = await list('?q=second', primaryUser());
    const page = await list('?limit=2', primaryUser());

    expect(res.body.messages.map((m) => m.subject)).toEqual(['Second']);
    expect(res.body.messages[0].isRead).toBeNull();
    expect(page.body).toMatchObject({ total: 3 });
    expect(page.body.messages).toHaveLength(2);
  });
});

describe('GET /mailbox/messages/:id', () => {
  it('returns the message in full, HTML body included', async () => {
    const { newer } = await seed();

    const res = await request(app).get(`/api/v1/mailbox/messages/${newer.mailboxMessageId}`).set(cookieFor(nicUser()));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mailboxMessageId: newer.mailboxMessageId,
      bodyHtml: '<p>Please clarify the applicable <b>dissolution</b> limits.</p>',
      status: 'NEW',
      attachments: [expect.objectContaining({ attachmentId: ATT_A })],
    });
  });

  it('finds a primary-mailbox message whether or not it is still awaiting validation', async () => {
    const delivered = await request(app)
      .post('/api/v1/mailbox/receive')
      .set(cookieFor(superAdmin()))
      .send({ from: 'someone@example.invalid', subject: 'Handled already', body: 'Body text.' });
    const id = delivered.body.mailboxMessageId;

    const awaiting = await request(app).get(`/api/v1/mailbox/messages/${id}`).set(cookieFor(primaryUser()));
    await request(app).post(`/api/v1/mailbox/messages/${id}/ingested`).set(cookieFor(primaryUser()));
    const handled = await request(app).get(`/api/v1/mailbox/messages/${id}`).set(cookieFor(primaryUser()));

    expect(awaiting.status).toBe(200);
    expect(handled.status).toBe(200);
    expect(handled.body).toMatchObject({ subject: 'Handled already', isRead: null });
  });

  it('is not found from another mailbox, or once removed', async () => {
    const { newer } = await seed();
    const path = `/api/v1/mailbox/messages/${newer.mailboxMessageId}`;

    expect((await request(app).get(path).set(cookieFor(primaryUser()))).status).toBe(404);
    expect((await request(app).get('/api/v1/mailbox/messages/NICB-unknown').set(cookieFor(nicUser()))).status).toBe(404);

    await request(app).delete(path).set(cookieFor(nicUser()));
    expect((await request(app).get(path).set(cookieFor(nicUser()))).status).toBe(404);
  });
});

describe('GET /mailbox/messages/:id/attachments/:attachmentId', () => {
  it('serves an attachment of that message, and records who downloaded it from which message', async () => {
    const { newer } = await seed();

    const res = await request(app)
      .get(`/api/v1/mailbox/messages/${newer.mailboxMessageId}/attachments/${ATT_A}?download=1`)
      .set(cookieFor(nicUser()));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(audits('ATTACHMENT_DOWNLOADED')[0]).toMatchObject({
      attachmentId: ATT_A,
      messageId: newer.mailboxMessageId,
    });
  });

  it('will not serve an attachment through a message it does not belong to', async () => {
    const { newer, older } = await seed();

    const other = await request(app)
      .get(`/api/v1/mailbox/messages/${newer.mailboxMessageId}/attachments/${ATT_B}`)
      .set(cookieFor(nicUser()));
    const wrongMessage = await request(app)
      .get(`/api/v1/mailbox/messages/${older.mailboxMessageId}/attachments/${ATT_A}`)
      .set(cookieFor(nicUser()));

    expect(other.status).toBe(404);
    expect(wrongMessage.status).toBe(404);
  });
});

describe('POST /mailbox/messages/:id/read', () => {
  const markRead = (id, user = nicUser()) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/read`).set(cookieFor(user));

  it('marks it read in the QMS, once, and never touches NICeMail', async () => {
    const { newer } = await seed();

    const first = await markRead(newer.mailboxMessageId);
    const again = await markRead(newer.mailboxMessageId);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ isRead: true, status: 'READ', ingested: false, readByUserId: nicUser().id });
    expect(again.status).toBe(200);
    expect(audits('EMAIL_MARKED_READ')).toHaveLength(1);
    expect(browser.readInbox).not.toHaveBeenCalled();
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('is refused for a mailbox that keeps no read state, and not found for an unknown id', async () => {
    await seed();

    expect((await markRead('MSG-00001', primaryUser())).status).toBe(409);
    expect((await markRead('NICB-unknown')).status).toBe(404);
  });
});

describe('POST /mailbox/sync', () => {
  const syncAs = (user) => request(app).post('/api/v1/mailbox/sync').set(cookieFor(user));

  it('starts a NICeMail sync in the background, and not a second one on top of it', async () => {
    let finish;
    browser.readInbox = vi.fn(() => new Promise((resolve) => (finish = resolve)));

    const first = await syncAs(nicUser());
    const second = await syncAs(nicUser());
    finish({ messages: [], failures: [], remaining: 0 });

    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ supported: true, started: true, sync: { running: true } });
    expect(second.body).toMatchObject({ supported: true, started: false });
    expect(browser.readInbox).toHaveBeenCalledTimes(1);
    expect(audits('SYNC_STARTED')).toEqual([expect.objectContaining({ actorId: nicUser().id })]);
  });

  it('is not started again moments after one finished', async () => {
    await nicMailbox.sync(NIC_ADDRESS);

    const res = await syncAs(nicUser());

    expect(res.body).toMatchObject({ started: false });
  });

  it('has nothing to start for the primary mailbox', async () => {
    const res = await syncAs(primaryUser());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ supported: false, started: false });
  });
});

describe('a NICeMail viewer', () => {
  beforeEach(async () => {
    await seed();
    nicMailbox.resetSyncState();
    vi.stubEnv('NIC_BROWSER_VIEWER', 'true');
  });

  it('lists what the mailbox host stored, and never reads NICeMail itself', async () => {
    const res = await request(app).get('/api/v1/mailbox/messages').set(cookieFor(nicUser()));

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.sync).toMatchObject({ viewer: true, running: false });
    expect(browser.readInbox).not.toHaveBeenCalled();
  });

  it('starts no sync when asked for one, and records none', async () => {
    const res = await request(app).post('/api/v1/mailbox/sync').set(cookieFor(nicUser()));

    expect(res.body).toMatchObject({ started: false, sync: { viewer: true, running: false } });
    expect(browser.readInbox).not.toHaveBeenCalled();
    expect(audits('SYNC_STARTED')).toEqual([]);
  });
});
