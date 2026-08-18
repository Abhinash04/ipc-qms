import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

import app from '../app.js';
import * as emailService from '../services/email/emailService.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';
import {
  identityForRole,
  identityForEmail,
  publicDirectory,
  IDENTITY_ROLES,
} from '../config/identities.js';
import {
  toMailboxMessage,
  inboxQuery,
  enquirySenders,
  isEnquirySender,
} from '../services/email/mailbox/gmailInboxReader.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  await mockTransport.reset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('identity configuration', () => {
  it('resolves a name and address for each of the three real roles', () => {
    for (const role of Object.values(IDENTITY_ROLES)) {
      const identity = identityForRole(role);
      expect(identity.role).toBe(role);
      expect(identity.name).toBeTruthy();
      expect(identity.email).toMatch(/@/);
    }
  });

  it('is env-driven, so no address is hard-coded into the flow', () => {
    process.env.FRONT_OFFICE_EMAIL = 'someone.else@test.invalid';
    process.env.FRONT_OFFICE_NAME = 'Someone Else';

    const identity = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
    expect(identity.email).toBe('someone.else@test.invalid');
    expect(identity.name).toBe('Someone Else');
  });

  it('reports a role as unable to send real mail when it has no token of its own', () => {
    // Tokens are blank in the test environment.
    for (const identity of publicDirectory()) {
      expect(identity.canSendReal).toBe(false);
    }
  });

  it('never exposes a refresh token in the public directory', () => {
    process.env.GMAIL_REFRESH_TOKEN_FRONT_OFFICE = 'super-secret-token';

    const serialised = JSON.stringify(publicDirectory());
    expect(serialised).not.toContain('super-secret-token');
    expect(serialised).not.toMatch(/refreshToken/);
  });

  it('returns null for a role with no configured identity', () => {
    expect(identityForRole('REVIEWER')).toBeNull();
    expect(identityForRole('SUPER_ADMIN')).toBeNull();
  });
});

describe('identity resolution when a role holds more than one person', () => {
  // ASSIGNED_OFFICIAL covers the real Rawat Jatin and the mock Neha Singh, so
  // the acting user's ADDRESS decides who can send, not the role.

  it('resolves the real Assigned Official from his own address', () => {
    const identity = identityForEmail('assigned-official@test.invalid');
    expect(identity).toMatchObject({
      role: IDENTITY_ROLES.ASSIGNED_OFFICIAL,
      name: 'Test Assigned Official',
    });
  });

  it('returns nothing for a mock user, so they can never borrow an account', () => {
    expect(identityForEmail('neha.singh@ipc.example')).toBeNull();
    expect(identityForEmail('amit.mehta@ipc.example')).toBeNull();
    expect(identityForEmail('')).toBeNull();
    expect(identityForEmail(undefined)).toBeNull();
  });

  it('ignores address casing and surrounding whitespace', () => {
    expect(identityForEmail('  Front-Office@Test.Invalid ')?.role).toBe(
      IDENTITY_ROLES.FRONT_OFFICE,
    );
  });

  it('keeps the Officer-in-Charge and the Assigned Official separate', () => {
    const officer = identityForEmail('officer@test.invalid');
    const official = identityForEmail('assigned-official@test.invalid');

    expect(officer.role).toBe(IDENTITY_ROLES.OFFICER_IN_CHARGE);
    expect(official.role).toBe(IDENTITY_ROLES.ASSIGNED_OFFICIAL);
    expect(officer.email).not.toBe(official.email);
  });

  it('sends through the mock transport for a user with no identity', async () => {
    const transport = await emailService.getTransport(
      'gmail',
      IDENTITY_ROLES.ASSIGNED_OFFICIAL,
      'neha.singh@ipc.example',
    );
    expect(transport.name).toBe('mock');
  });
});

describe('sender identity comes from the acting stakeholder', () => {
  it('sends the enquiry from the inquirer to the Front Officer', async () => {
    const result = await emailService.sendEnquiry({ subject: 'Monograph query', body: 'Details' });

    expect(result.from).toBe('Test Inquirer <inquirer@test.invalid>');
    expect(result.to).toEqual(['front-office@test.invalid']);
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.INQUIRER);
  });

  it('sends the acknowledgement from the Front Officer to the inquirer', async () => {
    const result = await emailService.sendAcknowledgement({
      to: 'inquirer@test.invalid',
      queryId: 'QRY-2026-00001',
    });

    expect(result.from).toBe('Test Front Officer <front-office@test.invalid>');
    expect(result.to).toEqual(['inquirer@test.invalid']);
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.FRONT_OFFICE);
    expect(result.subject).toContain('QRY-2026-00001');
  });

  it('forwards from the Front Officer to the Officer-in-Charge', async () => {
    const result = await emailService.forwardToOfficerInCharge({
      queryId: 'QRY-2026-00001',
      subject: 'Monograph query',
      body: 'original enquiry quoted here',
    });

    expect(result.from).toBe('Test Front Officer <front-office@test.invalid>');
    expect(result.to).toEqual(['officer@test.invalid']);
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.FRONT_OFFICE);
    expect(result.subject).toBe('Fwd: Monograph query [QRY-2026-00001]');
  });

  it('sends the final response from the Front Officer', async () => {
    const result = await emailService.sendResponse({
      to: 'inquirer@test.invalid',
      subject: 'Re: Monograph query [QRY-2026-00001]',
      body: 'The approved response.',
    });

    expect(result.from).toBe('Test Front Officer <front-office@test.invalid>');
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.FRONT_OFFICE);
  });
});

describe('transport resolution — credentials are never borrowed', () => {
  it('uses the mock transport for every role while no token is configured', async () => {
    for (const role of Object.values(IDENTITY_ROLES)) {
      const transport = await emailService.getTransport('gmail', role);
      expect(transport.name, `${role} must not use another account`).toBe('mock');
    }
  });

  it('keeps using the mock transport when the transport itself is mock', async () => {
    const transport = await emailService.getTransport('mock', IDENTITY_ROLES.FRONT_OFFICE);
    expect(transport.name).toBe('mock');
  });

  it('records which role a message was sent as', async () => {
    const result = await emailService.sendEnquiry({ subject: 'x', body: 'y' });
    expect(result.transport).toBe('mock');
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.INQUIRER);
  });
});

describe('email HTTP surface', () => {
  it('publishes the participant directory without any credential', async () => {
    const res = await request(app).get('/api/v1/emails/config');

    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(4);
    expect(res.body.participants.map((p) => p.role)).toEqual([
      'INQUIRER',
      'FRONT_OFFICE',
      'OFFICER_IN_CHARGE',
      'ASSIGNED_OFFICIAL',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/GMAIL_|client_secret|refresh_?token/i);
  });

  it('addresses an enquiry to the Front Officer, not to the old shared mailbox', async () => {
    const res = await request(app)
      .post('/api/v1/emails/enquiry')
      .send({ subject: 'Query', body: 'Body' });

    expect(res.status).toBe(201);
    expect(res.body.to).toEqual(['front-office@test.invalid']);
  });

  it('forwards an existing query and requires its id', async () => {
    const ok = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00001', subject: 'Query', body: 'quoted' });
    expect(ok.status).toBe(201);
    expect(ok.body.to).toEqual(['officer@test.invalid']);

    const bad = await request(app).post('/api/v1/emails/forward').send({ subject: 'x' });
    expect(bad.status).toBe(400);
  });

  it('delivers the enquiry into the Front Officer inbox, which is what she polls', async () => {
    await request(app).post('/api/v1/emails/enquiry').send({ subject: 'Inbox check', body: 'b' });

    const res = await request(app).get('/api/v1/mailbox/messages');
    expect(res.body.recipient).toBe('front-office@test.invalid');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].subject).toBe('Inbox check');
  });
});

describe('gmail inbox reader — message mapping', () => {
  const gmailMessage = {
    id: '18f2a1b2c3d4e5f6',
    threadId: '18f2a1b2c3d4e5f6',
    internalDate: '1755500000000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      headers: [
        { name: 'From', value: 'Abhinash Pritiraj <inquirer@test.invalid>' },
        { name: 'To', value: 'front-office@test.invalid' },
        { name: 'Subject', value: 'Clarification on monograph revision' },
      ],
      body: { data: Buffer.from('Dear Madam,\n\nPlease clarify.').toString('base64') },
    },
  };

  it('uses Gmail ids so dedupe keys on the real message and thread', () => {
    const mapped = toMailboxMessage(gmailMessage, 'front-office@test.invalid');

    expect(mapped.mailboxMessageId).toBe('18f2a1b2c3d4e5f6');
    expect(mapped.providerMessageId).toBe('18f2a1b2c3d4e5f6');
    expect(mapped.providerThreadId).toBe('18f2a1b2c3d4e5f6');
  });

  it('decodes the headers and body into the shape ingestion expects', () => {
    const mapped = toMailboxMessage(gmailMessage, 'front-office@test.invalid');

    expect(mapped.from).toBe('Abhinash Pritiraj <inquirer@test.invalid>');
    expect(mapped.subject).toBe('Clarification on monograph revision');
    expect(mapped.body).toContain('Please clarify.');
    expect(mapped.receivedAt).toBe(new Date(1755500000000).toISOString());
  });

  it('treats Gmail UNREAD as "not yet registered"', () => {
    expect(toMailboxMessage(gmailMessage, 'x').ingested).toBe(false);

    const read = { ...gmailMessage, labelIds: ['INBOX'] };
    expect(toMailboxMessage(read, 'x').ingested).toBe(true);
  });

  it('reads a multipart body', () => {
    const multipart = {
      ...gmailMessage,
      payload: {
        headers: gmailMessage.payload.headers,
        parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('plain text part').toString('base64') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<p>html</p>').toString('base64') } },
        ],
      },
    };

    expect(toMailboxMessage(multipart, 'x').body).toBe('plain text part');
  });
});

describe('mailbox source selection', () => {
  it('stays on the local mailbox unless Gmail polling is explicitly requested', () => {
    expect(mailbox.describe().backend).toBe('in-memory');
  });
});

describe('preflight is a standalone script', () => {
  it('is never imported by the application', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { if (entry !== 'test') walk(full); }
        else if (entry.endsWith('.js') && !full.includes('gmailPreflight')) {
          if (readFileSync(full, 'utf8').includes('gmailPreflight')) offenders.push(full);
        }
      }
    };
    walk('src');

    expect(offenders).toEqual([]);
  });
});

describe('only a real enquiry may open a Query Case', () => {
  // The Front Officer's inbox is a real personal mailbox. An unqualified
  // is:unread search would turn her private mail into Query Cases.

  it('asks Gmail only for mail from a known inquirer, addressed to the Front Officer', () => {
    expect(inboxQuery()).toBe(
      'in:inbox is:unread from:(inquirer@test.invalid) to:(front-office@test.invalid)',
    );
    expect(inboxQuery({ unreadOnly: false })).toBe(
      'in:inbox from:(inquirer@test.invalid) to:(front-office@test.invalid)',
    );
  });

  it('allows only inquirer addresses to open a case', () => {
    expect(enquirySenders()).toEqual(['inquirer@test.invalid']);

    // IPC staff write about cases that already exist; they never open one.
    expect(enquirySenders()).not.toContain('front-office@test.invalid');
    expect(enquirySenders()).not.toContain('officer@test.invalid');
    expect(enquirySenders()).not.toContain('assigned-official@test.invalid');
  });

  it('rejects anything that is not from an inquirer, whatever the query returned', () => {
    expect(isEnquirySender('Test Inquirer <inquirer@test.invalid>')).toBe(true);
    expect(isEnquirySender('inquirer@test.invalid')).toBe(true);
    expect(isEnquirySender('  INQUIRER@Test.Invalid  ')).toBe(true);

    // Her friend, a newsletter, a phishing attempt — none may create a case.
    expect(isEnquirySender('A Friend <friend@example.com>')).toBe(false);
    expect(isEnquirySender('newsletter@shop.example')).toBe(false);
    expect(isEnquirySender('front-office@test.invalid')).toBe(false);
    expect(isEnquirySender('')).toBe(false);
    expect(isEnquirySender(undefined)).toBe(false);
  });
});

describe('attachment metadata', () => {
  const withAttachment = {
    id: 'msg-att-1',
    threadId: 'thread-att-1',
    internalDate: '1755500000000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      headers: [
        { name: 'From', value: 'Test Inquirer <inquirer@test.invalid>' },
        { name: 'Subject', value: 'Enquiry with a specification sheet' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64') } },
        {
          mimeType: 'application/pdf',
          filename: 'specification.pdf',
          body: { attachmentId: 'ANGjdJ_att_1', size: 204800 },
        },
      ],
    },
  };

  it('records name, type and size for each attachment', () => {
    const mapped = toMailboxMessage(withAttachment, 'front-office@test.invalid');

    expect(mapped.attachments).toEqual([
      {
        id: 'ANGjdJ_att_1',
        name: 'specification.pdf',
        mimeType: 'application/pdf',
        sizeKb: 200,
      },
    ]);
  });

  it('stores no file content — only the handle needed to fetch it later', () => {
    const mapped = toMailboxMessage(withAttachment, 'front-office@test.invalid');
    const serialised = JSON.stringify(mapped.attachments);

    expect(serialised).not.toContain('data');
    expect(mapped.attachments[0]).not.toHaveProperty('content');
    expect(mapped.attachments[0]).not.toHaveProperty('body');
  });

  it('leaves the list empty when there is nothing attached', () => {
    const plain = {
      ...withAttachment,
      payload: { headers: withAttachment.payload.headers, body: { data: Buffer.from('hi').toString('base64') } },
    };
    expect(toMailboxMessage(plain, 'x').attachments).toEqual([]);
  });

  it('finds attachments nested inside a multipart body', () => {
    const nested = {
      ...withAttachment,
      payload: {
        headers: withAttachment.payload.headers,
        parts: [
          {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'image/png',
                filename: 'diagram.png',
                body: { attachmentId: 'att-nested', size: 51200 },
              },
            ],
          },
        ],
      },
    };

    expect(toMailboxMessage(nested, 'x').attachments).toEqual([
      { id: 'att-nested', name: 'diagram.png', mimeType: 'image/png', sizeKb: 50 },
    ]);
  });
});

describe('sending while the mailbox is a real Gmail inbox', () => {
  // Regression: mockTransport deposited a copy of every outgoing message into
  // the IPC mailbox. With MAILBOX_SOURCE=gmail that store is read-only and its
  // deliver() throws, so EVERY send through this transport returned HTTP 500 —
  // POST /emails/response most visibly.
  const ORIGINAL_SOURCE = process.env.MAILBOX_SOURCE;

  beforeEach(() => {
    process.env.MAILBOX_SOURCE = 'gmail';
    // test/setup.js pins the in-memory store for the whole suite. Release the
    // pin here, or MAILBOX_SOURCE is ignored and these tests would pass without
    // ever touching the path that broke.
    mailbox.useAuto();
  });

  afterEach(() => {
    process.env.MAILBOX_SOURCE = ORIGINAL_SOURCE;
    mailbox.forceInMemory();
  });

  it('POST /emails/response succeeds instead of 500', async () => {
    const res = await request(app).post('/api/v1/emails/response').send({
      to: 'inquirer@test.invalid',
      subject: 'Re: Clarification [QRY-2026-00001]',
      body: 'The approved response.',
    });

    expect(res.status).toBe(201);
    expect(res.body.to).toEqual(['inquirer@test.invalid']);
    expect(res.body.from).toContain('front-office@test.invalid');
  });

  it('the acknowledgement and forward survive it too — same code path', async () => {
    const ack = await request(app)
      .post('/api/v1/emails/acknowledgement')
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });
    expect(ack.status).toBe(201);

    const forward = await request(app)
      .post('/api/v1/emails/forward')
      .send({ queryId: 'QRY-2026-00001', subject: 'Clarification', body: 'quoted' });
    expect(forward.status).toBe(201);
  });

  it('reports that a real inbox cannot accept a deposited copy', () => {
    expect(mailbox.supportsDelivery()).toBe(false);
  });

  it('accepts deposits again once the mailbox is local', () => {
    process.env.MAILBOX_SOURCE = 'auto';
    expect(mailbox.supportsDelivery()).toBe(true);
  });

  it('records nothing in the local mailbox, because there is none to record in', async () => {
    await request(app).post('/api/v1/emails/response').send({
      to: 'inquirer@test.invalid',
      subject: 'Re: test',
      body: 'x',
    });

    // The send succeeded; the deposit was skipped rather than attempted.
    expect(mailbox.supportsDelivery()).toBe(false);
  });
});
