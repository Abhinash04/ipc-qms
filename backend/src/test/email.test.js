import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { AUTH } from './helpers/auth.js';
import app from '../app.js';
import env, { validateEmailConfig } from '../config/env.js';
import * as emailService from '../services/email/emailService.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';
const arrive = (subject) =>
  request(app)
    .post('/api/v1/mailbox/receive').set(AUTH)
    .send({ from: 'Ravi Kumar <ravi@pharma.example>', subject, body: 'Body' });

import { buildAcknowledgement, ACKNOWLEDGEMENT_SUBJECT } from '../services/email/templates/acknowledgement.js';

beforeEach(async () => {
  await mockTransport.reset();
});

describe('email configuration', () => {
  it('defaults to the mock transport', () => {
    expect(env.EMAIL_TRANSPORT).toBe('mock');
  });

  it('exposes non-secret config only — never OAuth credentials', () => {
    const config = emailService.getEmailConfig();
    expect(config.ipcQueryEmail).toBe('front-office@test.invalid');
    expect(JSON.stringify(config)).not.toMatch(/GMAIL_|client_secret|refresh_token/i);
  });

  it('validates transport and mailbox selection', () => {
    expect(validateEmailConfig({ ...env, EMAIL_TRANSPORT: 'carrier-pigeon' })).toContainEqual(
      expect.stringContaining('EMAIL_TRANSPORT must be one of'),
    );

    expect(validateEmailConfig({ ...env, EMAIL_TRANSPORT: 'gmail' })).toContainEqual(
      expect.stringContaining('EMAIL_TRANSPORT must be one of: mock, nic'),
    );
    expect(validateEmailConfig({ ...env, MAILBOX_SOURCE: 'gmail' })).toContainEqual(
      expect.stringContaining('MAILBOX_SOURCE must be one of: auto, nic'),
    );

    expect(validateEmailConfig({ ...env, IPC_QUERY_EMAIL: '' })).toContainEqual(
      expect.stringContaining('IPC_QUERY_EMAIL is required'),
    );

    expect(validateEmailConfig(env)).toEqual([]);
  });

  describe('production refuses a configuration that cannot really send', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const inProduction = (overrides = {}) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('FRONT_OFFICE_EMAIL', 'front.office@ipc.gov.in');
      vi.stubEnv('OFFICER_IN_CHARGE_EMAIL', 'oic@ipc.gov.in');
      for (const [key, value] of Object.entries(overrides.envs || {})) vi.stubEnv(key, value);
      return validateEmailConfig({ ...env, ...overrides.config });
    };

    it('refuses the mock transport', () => {
      expect(inProduction({ config: { EMAIL_TRANSPORT: 'mock' } }).join(' ')).toMatch(
        /records emails as sent without sending them/,
      );
    });

    it('requires a real outbound channel', () => {
      expect(inProduction({ config: { EMAIL_TRANSPORT: 'mock' } }).join(' ')).toMatch(
        /needs a real outbound channel/,
      );
      const withAgent = inProduction({
        config: { EMAIL_TRANSPORT: 'mock' },
        envs: { NIC_BROWSER_MAILBOX: 'true', NIC_EMAIL: 'lab@ipc.gov.in', NIC_BROWSER_TEST_RECIPIENT: 'test@ipc.gov.in' },
      });
      expect(withAgent.join(' ')).not.toMatch(/needs a real outbound channel/);
    });

    it('refuses the unroutable placeholder addresses', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('FRONT_OFFICE_EMAIL', '');
      vi.stubEnv('OFFICER_IN_CHARGE_EMAIL', 'officer-in-charge-unconfigured@example.com');

      const errors = validateEmailConfig({ ...env, EMAIL_TRANSPORT: 'nic' }).join(' ');
      expect(errors).toMatch(/FRONT_OFFICE_EMAIL must be a real address/);
      expect(errors).toMatch(/OFFICER_IN_CHARGE_EMAIL must be a real address/);
    });
  });

  it('requires a test recipient while the outbound interlock is closed', () => {
    vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
    vi.stubEnv('NIC_EMAIL', 'lab@ipc.gov.in');
    vi.stubEnv('NIC_BROWSER_TEST_RECIPIENT', '');
    vi.stubEnv('NIC_TEST_RECIPIENT', '');

    expect(validateEmailConfig(env).join(' ')).toMatch(/NIC_BROWSER_TEST_RECIPIENT is required/);

    vi.stubEnv('NIC_ALLOW_OUTBOUND', 'true');
    expect(validateEmailConfig(env).join(' ')).not.toMatch(/NIC_BROWSER_TEST_RECIPIENT is required/);
    vi.unstubAllEnvs();
  });

  it('requires a real Officer-in-Charge address before the internal forward may be allowed', () => {
    vi.stubEnv('NIC_ALLOW_INTERNAL_FORWARD', 'true');
    vi.stubEnv('OFFICER_IN_CHARGE_EMAIL', 'officer-in-charge-unconfigured@example.com');

    expect(validateEmailConfig(env).join(' ')).toMatch(/NIC_ALLOW_INTERNAL_FORWARD=true requires a real/);

    vi.stubEnv('OFFICER_IN_CHARGE_EMAIL', 'oic@ipc.gov.in');
    expect(validateEmailConfig(env).join(' ')).not.toMatch(/NIC_ALLOW_INTERNAL_FORWARD/);
    vi.unstubAllEnvs();
  });

  it('selects the mock transport and never loads Gmail in the test path', async () => {
    expect((await emailService.getTransport()).name).toBe('mock');
    expect((await emailService.getTransport('mock')).name).toBe('mock');
  });
});

describe('mock mailbox determinism', () => {
  const deposit = (subject) =>
    emailService.sendAcknowledgement({ to: 'front-office@test.invalid', queryId: subject });

  it('mints sequential ids and resets them, so tests can assert exact values', async () => {
    await deposit('One');
    await deposit('Two');

    expect((await mailbox.list('front-office@test.invalid')).map((m) => m.mailboxMessageId)).toEqual([
      'MSG-00001',
      'MSG-00002',
    ]);

    await mockTransport.reset();
    await deposit('After reset');
    expect((await mailbox.list('front-office@test.invalid'))[0].mailboxMessageId).toBe('MSG-00001');
  });

  it('preserves delivery order and supports unreadOnly filtering', async () => {
    await deposit('First');
    await deposit('Second');

    await mailbox.markIngested('front-office@test.invalid', 'MSG-00001');

    const subjects = (await mailbox.list('front-office@test.invalid')).map((m) => m.subject);
    expect(subjects[0]).toContain('First');
    expect(subjects[1]).toContain('Second');
    const unread = await mailbox.list('front-office@test.invalid', { unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].subject).toContain('Second');
  });
});

describe('acknowledgement template', () => {
  it('uses the supplied wording and configurable sender', () => {
    const ack = buildAcknowledgement({
      to: 'inquirer@test.invalid',
      fromEmail: 'arnd-ipc-mock@example.com',
      fromName: 'AR&D Division',
      queryId: 'QRY-2026-00001',
    });

    expect(ack.from).toBe('AR&D Division <arnd-ipc-mock@example.com>');
    expect(ack.to).toEqual(['inquirer@test.invalid']);
    expect(ack.subject).toBe(`${ACKNOWLEDGEMENT_SUBJECT} [QRY-2026-00001]`);
    expect(ack.body).toContain('Greetings from the Indian Pharmacopoeia Commission (IPC)!');
    expect(ack.body).toContain('This is an auto-generated email. Please do not reply to this message.');
  });

  it('requires a recipient and a sender', () => {
    expect(() => buildAcknowledgement({ fromEmail: 'x@example.com' })).toThrow(/"to" is required/);
    expect(() => buildAcknowledgement({ to: 'x@example.com' })).toThrow(/"fromEmail" is required/);
  });
});

describe('email HTTP endpoints', () => {
  it('GET /emails/config returns the composer configuration', async () => {
    const res = await request(app).get('/api/v1/emails/config').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.transport).toBe('mock');
    expect(res.body.ipcQueryEmail).toBe('front-office@test.invalid');
    expect(res.body.participants.map((p) => p.role)).toEqual(['FRONT_OFFICE', 'OFFICER_IN_CHARGE']);
  });

  it('GET /emails/config reports the NICeMail channel as well as the transport', async () => {
    const quiet = await request(app).get('/api/v1/emails/config').set(AUTH);
    expect(quiet.body).toMatchObject({ nicBrowserMailbox: false, outboundAllowed: false });

    vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
    vi.stubEnv('NIC_EMAIL', 'lab@ipc.gov.in');
    vi.stubEnv('NIC_ALLOW_OUTBOUND', 'true');

    const live = await request(app).get('/api/v1/emails/config').set(AUTH);
    expect(live.body).toMatchObject({
      transport: 'mock',
      nicBrowserMailbox: true,
      outboundAllowed: true,
    });

    expect(JSON.stringify(live.body)).not.toMatch(/lab@ipc\.gov\.in/);
    vi.unstubAllEnvs();
  });

  it('POST /emails/acknowledgement sends the acknowledgement', async () => {
    const res = await request(app)
      .post('/api/v1/emails/acknowledgement').set(AUTH)
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });

    expect(res.status).toBe(201);
    expect(res.body.subject).toContain('Acknowledgement of Query Received');
    expect(res.body.to).toEqual(['inquirer@test.invalid']);
  });

  it('rejects a response with no recipient', async () => {
    const res = await request(app).post('/api/v1/emails/response').set(AUTH).send({ subject: 'x', body: 'y' });
    expect(res.status).toBe(400);
  });

  it('carries the query id in the acknowledgement subject, so the thread is identifiable', async () => {
    const res = await request(app)
      .post('/api/v1/emails/acknowledgement').set(AUTH)
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00042' });

    expect(res.body.subject).toContain('[QRY-2026-00042]');
    expect(res.body.providerMessageId).toBeTruthy();
  });

  it('does not put the acknowledgement back in the IPC inbox — no ingestion loop', async () => {
    await arrive('Loop check');
    await request(app)
      .post('/api/v1/emails/acknowledgement').set(AUTH)
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });

    const ipcInbox = await mailbox.list('front-office@test.invalid');
    expect(ipcInbox).toHaveLength(1);
    expect(ipcInbox[0].subject).toBe('Loop check');

    const inquirerInbox = await mailbox.list('inquirer@test.invalid');
    expect(inquirerInbox).toHaveLength(1);
    expect(inquirerInbox[0].subject).toContain('Acknowledgement of Query Received');
  });
});

describe('mailbox HTTP endpoints', () => {
  it('lists messages and flags in-memory persistence', async () => {
    await arrive('Listed');

    const res = await request(app).get('/api/v1/mailbox/messages').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.recipient).toBe('front-office@test.invalid');
    expect(res.body.persistence).toMatch(/cleared on backend restart/);
    expect(res.body.messages).toHaveLength(1);
  });

  it('accepts an externally-received message', async () => {
    const res = await request(app)
      .post('/api/v1/mailbox/receive').set(AUTH)
      .send({ from: 'someone@example.com', subject: 'Direct', body: 'Arrived outside the app' });

    expect(res.status).toBe(201);
    expect(res.body.mailboxMessageId).toBe('MSG-00001');
    expect(res.body.to).toBe('front-office@test.invalid');
  });

  it('rejects a received message with no sender', async () => {
    const res = await request(app).post('/api/v1/mailbox/receive').set(AUTH).send({ subject: 'No sender' });
    expect(res.status).toBe(400);
  });

  it('marks a message ingested and 404s for an unknown id', async () => {
    await arrive('To ingest');

    const ok = await request(app).post('/api/v1/mailbox/messages/MSG-00001/ingested').set(AUTH);
    expect(ok.status).toBe(200);
    expect(ok.body.ingested).toBe(true);

    const missing = await request(app).post('/api/v1/mailbox/messages/MSG-99999/ingested').set(AUTH);
    expect(missing.status).toBe(404);
  });

  it('deletes a single message and 404s for an unknown id', async () => {
    await arrive('Keep');
    await arrive('Doomed');

    const ok = await request(app).delete('/api/v1/mailbox/messages/MSG-00002').set(AUTH);
    expect(ok.status).toBe(200);
    expect(ok.body.deleted).toBe(true);
    expect(ok.body.message.subject).toBe('Doomed');

    const remaining = await mailbox.list('front-office@test.invalid');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].subject).toBe('Keep');

    const missing = await request(app).delete('/api/v1/mailbox/messages/MSG-99999').set(AUTH);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Message not found', messageId: 'MSG-99999' });
  });

  it('DELETE /mailbox clears the inbox', async () => {
    await arrive('Doomed');
    const res = await request(app).delete('/api/v1/mailbox').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
    expect(await mailbox.list('front-office@test.invalid')).toHaveLength(0);
  });
});
