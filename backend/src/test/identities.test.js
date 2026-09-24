import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { AUTH } from './helpers/auth.js';

import app from '../app.js';
import * as emailService from '../services/email/emailService.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';
import {
  identityForRole,
  publicDirectory,
  IDENTITY_ROLES,
} from '../config/identities.js';

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

  it('publishes only role, name and address', () => {
    for (const identity of publicDirectory()) {
      expect(Object.keys(identity).sort()).toEqual(['email', 'name', 'role']);
    }
  });

  it('returns null for a role with no configured identity', () => {
    expect(identityForRole('REVIEWER')).toBeNull();
    expect(identityForRole('SUPER_ADMIN')).toBeNull();
  });
});

describe('sender identity comes from the acting stakeholder', () => {
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

describe('transport resolution is name-driven', () => {
  it('gives every role the same transport', async () => {
    for (const role of Object.values(IDENTITY_ROLES)) {
      expect((await emailService.getTransport('mock', role)).name, role).toBe('mock');
      expect((await emailService.getTransport('nic', role)).name, role).toBe('nic');
    }
  });

  it('reaches a real transport only when EMAIL_TRANSPORT names one', async () => {
    expect((await emailService.getTransport('mock')).name).toBe('mock');
    expect((await emailService.getTransport('nic')).name).toBe('nic');
    expect((await emailService.getTransport('gmail')).name).toBe('mock');
  });

  it('records which role a message was sent as', async () => {
    const result = await emailService.sendAcknowledgement({ to: 'inquirer@test.invalid', queryId: 'QRY-1' });
    expect(result.transport).toBe('mock');
    expect(result.sentAsRole).toBe(IDENTITY_ROLES.FRONT_OFFICE);
  });
});

describe('email HTTP surface', () => {
  it('publishes the participant directory without any credential', async () => {
    const res = await request(app).get('/api/v1/emails/config').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(2);
    expect(res.body.participants.map((p) => p.role)).toEqual(['FRONT_OFFICE', 'OFFICER_IN_CHARGE']);
    expect(JSON.stringify(res.body)).not.toMatch(/GMAIL_|client_secret|refresh_?token/i);
  });

  it('forwards an existing query and requires its id', async () => {
    const ok = await request(app)
      .post('/api/v1/emails/forward').set(AUTH)
      .send({ queryId: 'QRY-2026-00001', subject: 'Query', body: 'quoted' });
    expect(ok.status).toBe(201);
    expect(ok.body.to).toEqual(['officer@test.invalid']);

    const bad = await request(app).post('/api/v1/emails/forward').set(AUTH).send({ subject: 'x' });
    expect(bad.status).toBe(400);
  });

  it('delivers a sent copy into the Front Officer inbox, which is what she polls', async () => {
    await emailService.sendAcknowledgement({ to: 'front-office@test.invalid', queryId: 'QRY-1' });

    const res = await request(app).get('/api/v1/mailbox/messages').set(AUTH);
    expect(res.body.recipient).toBe('front-office@test.invalid');
    expect(res.body.messages).toHaveLength(1);
  });
});

describe('mailbox source selection', () => {
  it('stays on the local mailbox unless another source is explicitly requested', () => {
    expect(mailbox.describe().backend).toBe('in-memory');
  });
});

describe('the operator scripts are standalone', () => {
  it('are never imported by the application', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, basename } = await import('node:path');

    const scripts = readdirSync('src/scripts')
      .filter((entry) => entry.endsWith('.js'))
      .map((entry) => basename(entry, '.js'));
    expect(scripts.length).toBeGreaterThan(0);

    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'test' && entry !== 'scripts') walk(full);
        } else if (entry.endsWith('.js')) {
          const source = readFileSync(full, 'utf8');
          for (const script of scripts) {
            if (source.includes(`scripts/${script}`)) offenders.push(`${full} -> ${script}`);
          }
        }
      }
    };
    walk('src');

    expect(offenders).toEqual([]);
  });
});

describe('sending while the mailbox is a read-only NICeMail IMAP inbox', () => {
  const ORIGINAL_SOURCE = process.env.MAILBOX_SOURCE;

  beforeEach(() => {
    process.env.MAILBOX_SOURCE = 'nic';
    mailbox.useAuto();
  });

  afterEach(() => {
    process.env.MAILBOX_SOURCE = ORIGINAL_SOURCE;
    mailbox.forceInMemory();
  });

  it('POST /emails/response succeeds instead of 500', async () => {
    const res = await request(app).post('/api/v1/emails/response').set(AUTH).send({
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
      .post('/api/v1/emails/acknowledgement').set(AUTH)
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });
    expect(ack.status).toBe(201);

    const forward = await request(app)
      .post('/api/v1/emails/forward').set(AUTH)
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
    await request(app).post('/api/v1/emails/response').set(AUTH).send({
      to: 'inquirer@test.invalid',
      subject: 'Re: test',
      body: 'x',
    });

    expect(mailbox.supportsDelivery()).toBe(false);
  });
});
