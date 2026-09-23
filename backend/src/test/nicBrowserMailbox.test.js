import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * The NICeMail browser mailbox as a second Front Office mailbox.
 *
 * No browser anywhere: the reader and the sender are replaced at their module
 * boundary, so these tests are about what the QMS does with mail the agent
 * hands it — routing to the right Front Officer, storing each message once,
 * and answering the inquirer through the mailbox the enquiry came in on.
 *
 * Models are replaced with the in-memory stand-in in support/memoryDb.js, as
 * acceptMessage.test.js does.
 */

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

// The browser itself. Nothing here may reach Chrome.
const browser = vi.hoisted(() => ({ sendMail: null }));
vi.mock('../services/email/nic/browser/sendMail.js', () => ({
  sendMail: (...args) => browser.sendMail(...args),
}));

import { memoryDb as db } from './support/memoryDb.js';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import { ROLES } from '../constants/roles.js';
import { USERS, nicFrontOfficeUser } from '../constants/users.js';
import { findByEmail } from '../services/auth/userDirectory.js';
import env, { validateEmailConfig } from '../config/env.js';
import * as mailbox from '../services/email/mailbox/index.js';
import * as nicMailbox from '../services/email/mailbox/nicBrowserMailbox.js';
import * as emailService from '../services/email/emailService.js';
import * as nicBrowserTransport from '../services/email/transports/nicBrowserTransport.js';
import { QueryCase, ResponseVersion } from '../models/index.js';
import { traceSink } from '../services/email/sendTrace.js';

const NIC_ADDRESS = 'nic-mailbox@test.invalid';
// USR-0014's own password, from src/test/fixtures/passwords.json. The NIC
// Front Office is config-derived (constants/users.js), but it resolves its
// credential by user id like every other account.
const NIC_PASSWORD = 'test-pw-nic-frontoffice-0014';
const INQUIRER = 'Ravi Kumar <ravi@pharma.example>';

const cookieFor = (user) => ({ Cookie: `${authConfig.COOKIE_NAME}=${signToken(user)}` });
const primaryFrontOffice = () => USERS.find((user) => user.role === ROLES.FRONT_OFFICE);

/** What the browser reader hands back for one inbox message. */
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

beforeEach(() => {
  db.reset();
  nicMailbox.resetSyncState();
  vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
  vi.stubEnv('NIC_EMAIL', NIC_ADDRESS);
  vi.stubEnv('NIC_FRONT_OFFICE_NAME', 'Eco-Clubs Front Office');
  vi.stubEnv('NIC_BROWSER_TEST_RECIPIENT', 'ravi@pharma.example');
  browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: null }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the second Front Office', () => {
  it('exists only when the NICeMail browser mailbox is enabled, and signs in as NIC_EMAIL', () => {
    expect(nicFrontOfficeUser()).toMatchObject({ role: ROLES.FRONT_OFFICE, email: NIC_ADDRESS, name: 'Eco-Clubs Front Office' });
    expect(findByEmail(NIC_ADDRESS)?.id).toBe('USR-0014');

    vi.stubEnv('NIC_BROWSER_MAILBOX', 'false');
    expect(nicFrontOfficeUser()).toBeNull();
    expect(findByEmail(NIC_ADDRESS)).toBeNull();
  });

  it('routes by mailbox owner: the NICeMail Front Officer gets that mailbox, everyone else the primary one', async () => {
    expect(await mailbox.forUser(nicFrontOfficeUser())).toMatchObject({ source: 'nic-browser', address: NIC_ADDRESS });
    expect(await mailbox.forUser(primaryFrontOffice())).toBeNull();
    expect(await mailbox.forUser({ email: 'admin@ipc.example', role: ROLES.SUPER_ADMIN })).toBeNull();
  });

  it('refuses a configuration that points both Front Offices at one address', () => {
    expect(validateEmailConfig()).toEqual([]);

    vi.stubEnv('NIC_EMAIL', process.env.FRONT_OFFICE_EMAIL);
    expect(validateEmailConfig()).toContain('NIC_EMAIL must differ from FRONT_OFFICE_EMAIL when NIC_BROWSER_MAILBOX=true');

    vi.stubEnv('NIC_EMAIL', '');
    expect(validateEmailConfig()).toContain('NIC_EMAIL is required when NIC_BROWSER_MAILBOX=true');
  });
});

/**
 * Dev login is a password-less switch between seeded demo accounts. The
 * NICeMail Front Office is not a demo account: its inbox is the live .gov.in
 * mailbox, and its session can make the browser agent send. NODE_ENV defaults
 * to "development" and the server listens on every interface, so without this
 * refusal anyone who could reach the port could read official mail.
 *
 * The suite runs with NODE_ENV=test, where dev login answers 404 before it
 * looks at anything — a test that only checked "not 200" would pass without
 * reaching the refusal. `env.NODE_ENV` is fixed when the module loads, so it is
 * set on the config object for these cases and put back after.
 */
describe('signing in as the NICeMail Front Office', () => {
  let nodeEnv;

  beforeEach(() => {
    nodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
  });

  afterEach(() => {
    env.NODE_ENV = nodeEnv;
  });

  it('refuses dev login, and sets no session', async () => {
    const res = await request(app).post('/api/v1/auth/dev-login').send({ email: NIC_ADDRESS });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/password/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('records the refused attempt', async () => {
    await request(app).post('/api/v1/auth/dev-login').send({ email: NIC_ADDRESS });

    const refused = db.rows('AuditEvent').find((row) => row.action === 'LOGIN_FAILED');
    expect(refused).toMatchObject({ actorId: 'USR-0014', result: 'denied' });
  });

  it('still lets a seeded demo account use dev login', async () => {
    const res = await request(app).post('/api/v1/auth/dev-login').send({ email: primaryFrontOffice().email });

    expect(res.status).toBe(200);
  });

  it('signs in with the password, like any account whose data is real', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: NIC_ADDRESS, password: NIC_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: NIC_ADDRESS, role: ROLES.FRONT_OFFICE });
  });
});

describe('syncing the NICeMail inbox', () => {
  it('stores each provider message exactly once, however often the inbox is read', async () => {
    const reader = vi.fn(async ({ skip }) => [read('row-1'), read('row-2')].filter((m) => !skip.has(m.providerMessageId)));

    await nicMailbox.sync(NIC_ADDRESS, { reader });
    await nicMailbox.sync(NIC_ADDRESS, { reader });
    await nicMailbox.sync(NIC_ADDRESS, { reader });

    expect(db.rows('MailboxMessage')).toHaveLength(2);
    // Already-stored ids are handed to the reader, so it does not reopen them.
    expect([...reader.mock.calls[2][0].skip]).toEqual(['row-1', 'row-2']);
  });

  it('stores a message even when a reader returns it again, without resetting its state', async () => {
    const reader = async () => [read('row-1')];
    await nicMailbox.sync(NIC_ADDRESS, { reader });

    const [stored] = await nicMailbox.list(NIC_ADDRESS);
    await nicMailbox.markIngested(NIC_ADDRESS, stored.mailboxMessageId);
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1', { subject: 'changed' })] });

    const [again] = await nicMailbox.list(NIC_ADDRESS);
    expect(db.rows('MailboxMessage')).toHaveLength(1);
    expect(again).toMatchObject({ ingested: true, subject: 'Enquiry row-1' });
  });

  it('does not bring back a message the Front Office removed', async () => {
    const reader = async () => [read('row-1')];
    await nicMailbox.sync(NIC_ADDRESS, { reader });
    const [stored] = await nicMailbox.list(NIC_ADDRESS);

    await nicMailbox.remove(NIC_ADDRESS, stored.mailboxMessageId);
    await nicMailbox.sync(NIC_ADDRESS, { reader });

    expect(await nicMailbox.list(NIC_ADDRESS)).toEqual([]);
  });

  it('records a failed sync instead of throwing, so the stored inbox still lists', async () => {
    const reader = async () => {
      throw Object.assign(new Error('Chrome is not available for browser automation.'), { stage: 'connect_browser' });
    };

    const status = await nicMailbox.sync(NIC_ADDRESS, { reader });

    expect(status).toMatchObject({ ok: false, stage: 'connect_browser' });
    expect(await nicMailbox.list(NIC_ADDRESS)).toEqual([]);
  });
});

describe('the Front Office inbox endpoint', () => {
  beforeEach(async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1')] });
  });

  it('shows NICeMail mail to the NICeMail Front Officer only', async () => {
    const nic = await request(app).get('/api/v1/mailbox/messages').set(cookieFor(nicFrontOfficeUser()));
    expect(nic.status).toBe(200);
    expect(nic.body).toMatchObject({ recipient: NIC_ADDRESS, backend: 'nic-browser' });
    expect(nic.body.messages.map((m) => m.subject)).toEqual(['Enquiry row-1']);

    const primary = await request(app).get('/api/v1/mailbox/messages').set(cookieFor(primaryFrontOffice()));
    expect(primary.status).toBe(200);
    expect(primary.body.messages.map((m) => m.subject)).not.toContain('Enquiry row-1');
  });

  it('cannot be pointed at another mailbox with ?recipient=', async () => {
    const res = await request(app)
      .get(`/api/v1/mailbox/messages?recipient=${encodeURIComponent(process.env.FRONT_OFFICE_EMAIL)}`)
      .set(cookieFor(nicFrontOfficeUser()));

    expect(res.body.recipient).toBe(NIC_ADDRESS);
  });
});

describe('accepting a NICeMail message', () => {
  const acceptAs = (user, id, body = {}) =>
    request(app).post(`/api/v1/mailbox/messages/${id}/accept`).set(cookieFor(user)).send(body);

  it('registers the case from the stored message and acknowledges through NICeMail', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1')] });
    const [stored] = await nicMailbox.list(NIC_ADDRESS);

    // The client body is ignored for a browser-read message: the stored record is the enquiry.
    const res = await acceptAs(nicFrontOfficeUser(), stored.mailboxMessageId, {
      from: 'forged@example.com',
      subject: 'forged',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: true, acknowledged: true, errors: expect.any(Array) });

    const [caseRow] = db.rows('QueryCase');
    expect(caseRow.inquirer.email).toBe('ravi@pharma.example');
    expect(caseRow.subject).toBe('Enquiry row-1');
    expect(caseRow.sourceMailbox).toEqual({ source: 'nic-browser', address: NIC_ADDRESS });

    // The acknowledgement went out through the browser session, to the inquirer.
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
    expect(browser.sendMail.mock.calls[0][0].to).toEqual(['ravi@pharma.example']);

    // A retry creates nothing new and does not acknowledge twice.
    await acceptAs(nicFrontOfficeUser(), stored.mailboxMessageId);
    expect(db.rows('QueryCase')).toHaveLength(1);
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
  });

  it('answers a repeat Accept with the acknowledgement that already went, and its NICeMail id', async () => {
    browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: '1790056208843134900' }));
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-2')] });
    const [stored] = await nicMailbox.list(NIC_ADDRESS);

    const first = await acceptAs(nicFrontOfficeUser(), stored.mailboxMessageId);
    const again = await acceptAs(nicFrontOfficeUser(), stored.mailboxMessageId);

    expect(first.body.acknowledgement).toMatchObject({ outcome: 'SENT', providerMessageId: '1790056208843134900' });
    expect(again.body).toMatchObject({
      acknowledged: true,
      acknowledgement: { outcome: 'ALREADY_SENT', providerMessageId: '1790056208843134900' },
    });
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a message that is not in the NICeMail mailbox', async () => {
    const res = await acceptAs(nicFrontOfficeUser(), 'NICB-doesnotexist', { from: INQUIRER });
    expect(res.status).toBe(404);
    expect(db.rows('QueryCase')).toHaveLength(0);
  });

  it('leaves a primary-mailbox case on the configured transport', async () => {
    const res = await acceptAs(primaryFrontOffice(), 'gmail-msg-1', {
      from: INQUIRER,
      to: process.env.FRONT_OFFICE_EMAIL,
      subject: 'Via Gmail',
      body: 'x',
      receivedAt: '2026-09-18T09:00:00.000Z',
    });

    expect(res.status).toBe(200);
    expect(db.rows('QueryCase')[0].sourceMailbox.source).not.toBe('nic-browser');
    expect(browser.sendMail).not.toHaveBeenCalled();
  });
});

describe('outbound mail follows the case mailbox', () => {
  const nicCase = { source: 'nic-browser', address: NIC_ADDRESS };

  it('sends a NICeMail case response through the browser, from the NICeMail Front Office', async () => {
    const sent = await emailService.sendResponse({
      to: 'ravi@pharma.example',
      subject: 'Re: enquiry',
      body: 'Answer',
      sourceMailbox: nicCase,
    });

    expect(sent).toMatchObject({ transport: 'nic-browser', from: `Eco-Clubs Front Office <${NIC_ADDRESS}>` });
    expect(browser.sendMail).toHaveBeenCalledTimes(1);
  });

  it('keeps every other case on EMAIL_TRANSPORT', async () => {
    const sent = await emailService.sendResponse({ to: 'ravi@pharma.example', subject: 's', body: 'b' });
    expect(sent.transport).toBe('mock');
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('keeps the forward to the Officer-in-Charge off the browser', async () => {
    await emailService.forwardToOfficerInCharge({ queryId: 'QRY-2026-00001', subject: 's', body: 'b' });
    expect(browser.sendMail).not.toHaveBeenCalled();
  });

  it('confines browser sends to NIC_BROWSER_TEST_RECIPIENT until NIC_ALLOW_OUTBOUND=true', async () => {
    const message = { to: ['someone.else@example.com'], subject: 's', body: 'b' };

    await expect(nicBrowserTransport.send(message)).rejects.toThrow(/NIC_ALLOW_OUTBOUND/);
    expect(browser.sendMail).not.toHaveBeenCalled();

    vi.stubEnv('NIC_ALLOW_OUTBOUND', 'true');
    await expect(nicBrowserTransport.send(message)).resolves.toMatchObject({ transport: 'nic-browser' });
  });

  /**
   * The case page's retry buttons. They reach the email endpoints directly,
   * not through accept or final approval, and those endpoints used to send
   * with no mailbox at all — so a NICeMail case whose acknowledgement or
   * response had failed was retried from Bhumika's Gmail, past the NICeMail
   * interlock, to a member of the public.
   */
  describe('the case page retry buttons', () => {
    /**
     * An approved case, as the retry finds it. Everything the retry sends comes
     * from here — the inquirer, the subject, the approved text — because the
     * request may name only which case, never who is written to or what with.
     */
    const storeCase = async (queryId, sourceMailbox) => {
      await QueryCase.create({
        queryId,
        subject: 'Dissolution limits',
        inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
        workflowState: 'READY_FOR_DISPATCH',
        sourceMailbox,
      });
      await ResponseVersion.create({
        responseId: `RESP-${queryId}`,
        queryId,
        version: 'v1',
        content: 'The limit is stated in the current monograph.',
        status: 'FINAL_APPROVED',
        createdAt: '2026-09-18T09:00:00.000Z',
      });
    };

    /** The retry goes to the inquirer stored on the case — the body cannot redirect it. */
    it('sends to the inquirer on the case, whatever the request names', async () => {
      await storeCase('QRY-2026-00012', nicCase);

      await request(app)
        .post('/api/v1/emails/response')
        .set(cookieFor(primaryFrontOffice()))
        .send({ to: 'someone-else@elsewhere.example', subject: 'x', body: 'y', queryId: 'QRY-2026-00012' });

      expect(browser.sendMail).toHaveBeenCalledTimes(1);
      const sent = browser.sendMail.mock.calls[0][0];
      expect(sent.to).toEqual(['ravi@pharma.example']);
      expect(sent.body).toBe('The limit is stated in the current monograph.');
    });

    it('retries a NICeMail acknowledgement through the browser', async () => {
      await storeCase('QRY-2026-00007', nicCase);

      const res = await request(app)
        .post('/api/v1/emails/acknowledgement')
        .set(cookieFor(primaryFrontOffice()))
        .send({ to: 'ravi@pharma.example', queryId: 'QRY-2026-00007' });

      expect(res.status).toBe(201);
      expect(res.body.transport).toBe('nic-browser');
      expect(browser.sendMail).toHaveBeenCalledTimes(1);
    });

    it('retries a NICeMail final response through the browser', async () => {
      await storeCase('QRY-2026-00008', nicCase);

      const res = await request(app)
        .post('/api/v1/emails/response')
        .set(cookieFor(primaryFrontOffice()))
        .send({ to: 'ravi@pharma.example', subject: 'Re: enquiry', body: 'Answer', queryId: 'QRY-2026-00008' });

      expect(res.status).toBe(201);
      expect(res.body.transport).toBe('nic-browser');
      expect(browser.sendMail).toHaveBeenCalledTimes(1);
    });

    it('keeps a case from any other mailbox on EMAIL_TRANSPORT', async () => {
      await storeCase('QRY-2026-00009', null);

      const res = await request(app)
        .post('/api/v1/emails/response')
        .set(cookieFor(primaryFrontOffice()))
        .send({ to: 'ravi@pharma.example', subject: 's', body: 'b', queryId: 'QRY-2026-00009' });

      expect(res.body.transport).toBe('mock');
      expect(browser.sendMail).not.toHaveBeenCalled();
    });

    /** The mailbox is the case's, never the caller's to choose. */
    it('ignores a mailbox named in the request body', async () => {
      await storeCase('QRY-2026-00010', null);

      const res = await request(app)
        .post('/api/v1/emails/response')
        .set(cookieFor(primaryFrontOffice()))
        .send({
          to: 'ravi@pharma.example',
          subject: 's',
          body: 'b',
          queryId: 'QRY-2026-00010',
          sourceMailbox: nicCase,
        });

      expect(res.body.transport).toBe('mock');
      expect(browser.sendMail).not.toHaveBeenCalled();
    });

    /**
     * A retry can itself end unconfirmed. The stand-in throws what sendMail
     * throws then (nicBrowserSendMail.test.js pins that shape); this pins that
     * the endpoint hands it to the page intact — the warning and the flag, not
     * a bare 500 — since the page is where the next retry would be pressed.
     */
    it('hands an unconfirmed send to the page with its warning, not a bare 500', async () => {
      await storeCase('QRY-2026-00011', nicCase);
      browser.sendMail = vi.fn(async () => {
        throw Object.assign(
          new Error('NICeMail may have sent this message but did not confirm it in time. Check the NICeMail Sent folder before retrying.'),
          { unconfirmed: true, status: 504, details: { unconfirmed: true } },
        );
      });

      const res = await request(app)
        .post('/api/v1/emails/acknowledgement')
        .set(cookieFor(primaryFrontOffice()))
        .send({ to: 'ravi@pharma.example', queryId: 'QRY-2026-00011' });

      expect(res.status).toBe(504);
      expect(res.body.error).toMatch(/Sent folder/);
      expect(res.body.unconfirmed).toBe(true);
    });

    /**
     * "504" alone sent the last investigation to the database. The step the
     * browser stopped at, what it ran into and what the page showed now travel
     * with the error — to the page, and onto the case's outbound record.
     */
    it('names the step a NICeMail send stopped at, in the answer and on the record', async () => {
      await storeCase('QRY-2026-00013', nicCase);
      browser.sendMail = vi.fn(async () => {
        throw Object.assign(new Error('NICeMail may have sent this message but did not confirm it in time.'), {
          unconfirmed: true,
          failedStep: 'await_compose_close',
          cause: new Error('Timeout 20000ms exceeded waiting for role="button" name="Send" → detached'),
          seen: 'dialog open: "Email Satisfaction Survey"; Send button still visible',
        });
      });

      const res = await request(app)
        .post('/api/v1/emails/acknowledgement')
        .set(cookieFor(primaryFrontOffice()))
        .send({ queryId: 'QRY-2026-00013' });

      expect(res.status).toBe(504);
      expect(res.body.stage).toBe('await_compose_close');
      expect(res.body.error).toMatch(/\[stage: await_compose_close; cause: Timeout 20000ms .*; seen: .*Send button still visible\]/);
      const [row] = db.rows('OutboundEmail');
      expect(row.lastError).toMatch(/stage: await_compose_close/);
    });

    it('stops an inquirer other than the test recipient at the outbound guard, before the browser', async () => {
      await QueryCase.create({
        queryId: 'QRY-2026-00014',
        subject: 'Dissolution limits',
        inquirer: { id: null, name: 'Someone', email: 'someone.else@example.com' },
        workflowState: 'PENDING_ASSIGNMENT',
        sourceMailbox: nicCase,
      });

      const res = await request(app)
        .post('/api/v1/emails/acknowledgement')
        .set(cookieFor(primaryFrontOffice()))
        .send({ queryId: 'QRY-2026-00014' });

      expect(res.status).toBe(503);
      expect(res.body.stage).toBe('outbound_guard');
      expect(res.body.error).toMatch(/NIC_ALLOW_OUTBOUND/);
      expect(browser.sendMail).not.toHaveBeenCalled();
    });

    it('answers a repeat with the send that already happened, and sends nothing', async () => {
      await storeCase('QRY-2026-00015', nicCase);
      browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: '1790056208843134900' }));
      const retry = () =>
        request(app).post('/api/v1/emails/acknowledgement').set(cookieFor(primaryFrontOffice())).send({ queryId: 'QRY-2026-00015' });

      const first = await retry();
      const second = await retry();

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ outcome: 'ALREADY_SENT', providerMessageId: '1790056208843134900' });
      expect(browser.sendMail).toHaveBeenCalledTimes(1);
      // The browser hears every step, so they can be logged.
      expect(browser.sendMail.mock.calls[0][1].onStage).toEqual(expect.any(Function));
    });

    it('logs each send from START to RESULT — and a repeat without touching the browser', async () => {
      await storeCase('QRY-2026-00016', nicCase);
      browser.sendMail = vi.fn(async () => ({ ok: true, providerMessageId: '1790056208843134900' }));
      const lines = [];
      vi.spyOn(traceSink, 'write').mockImplementation((line) => lines.push(line));
      const retry = () =>
        request(app).post('/api/v1/emails/acknowledgement').set(cookieFor(primaryFrontOffice())).send({ queryId: 'QRY-2026-00016' });

      await retry();
      const firstRun = lines.splice(0).map((line) => line.split(' {')[0]);
      await retry();
      const secondRun = lines.map((line) => line.split(' {')[0]);

      expect(firstRun).toEqual(['ACK START', 'ACK RESOLUTION', 'ACK NIC BROWSER', 'ACK RESULT']);
      expect(secondRun).toEqual(['ACK START', 'ACK RESULT']);
      expect(lines.at(-1)).toMatch(/"status":"ALREADY_SENT".*"providerMessageId":"1790056208843134900"/);
    });
  });

  it('throws when the browser send fails, so the case is not closed on it', async () => {
    browser.sendMail = vi.fn(async () => {
      throw new Error('NICeMail UI element "sendButton" was not found.');
    });

    await expect(
      nicBrowserTransport.send({ to: ['ravi@pharma.example'], subject: 's', body: 'b' }),
    ).rejects.toThrow(/sendButton/);
  });
});
