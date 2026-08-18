import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import env, { validateEmailConfig } from '../config/env.js';
import * as emailService from '../services/email/emailService.js';
import * as mockTransport from '../services/email/transports/mockTransport.js';
import * as mailbox from '../services/email/mailbox/index.js';
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
    expect(config.inquirer.email).toBe('inquirer@test.invalid');
    expect(JSON.stringify(config)).not.toMatch(/GMAIL_|client_secret|refresh_token/i);
  });

  it('validates transport selection and Gmail credential completeness', () => {
    expect(validateEmailConfig({ ...env, EMAIL_TRANSPORT: 'carrier-pigeon' })).toContainEqual(
      expect.stringContaining('EMAIL_TRANSPORT must be one of'),
    );

    const errors = validateEmailConfig({
      ...env,
      EMAIL_TRANSPORT: 'gmail',
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
    });
    expect(errors).toHaveLength(3);
    expect(errors.join(' ')).toMatch(/GMAIL_CLIENT_ID.*required/);

    expect(validateEmailConfig({ ...env, IPC_QUERY_EMAIL: '' })).toContainEqual(
      expect.stringContaining('IPC_QUERY_EMAIL is required'),
    );

    expect(validateEmailConfig(env)).toEqual([]);
  });

  it('selects the mock transport and never loads Gmail in the test path', async () => {
    expect((await emailService.getTransport()).name).toBe('mock');
    expect((await emailService.getTransport('mock')).name).toBe('mock');
  });
});

describe('sendEnquiry — sender identity comes from the acting stakeholder', () => {
  it('sends from the inquirer to the Front Officer', async () => {
    const result = await emailService.sendEnquiry({
      subject: 'Clarification on monograph revision',
      body: 'Please confirm the revised timeline.',
      timestamp: '2026-08-17T09:00:00.000Z',
    });

    expect(result.from).toBe('Test Inquirer <inquirer@test.invalid>');
    expect(result.to).toEqual(['front-office@test.invalid']);
    expect(result.transport).toBe('mock');
    expect(result.providerMessageId).toBe('mock-msg-1');
  });

  it('ignores any attempt to supply an arbitrary "from"', async () => {
    const result = await emailService.sendEnquiry({
      from: 'attacker@evil.example',
      subject: 'Spoof attempt',
      body: 'x',
    });
    expect(result.from).toBe('Test Inquirer <inquirer@test.invalid>');
  });

  it('delivers the enquiry into the mock IPC mailbox', async () => {
    await emailService.sendEnquiry({ subject: 'Test enquiry', body: 'Body', timestamp: '2026-08-17T09:00:00.000Z' });

    const messages = await mailbox.list('front-office@test.invalid');
    expect(messages).toHaveLength(1);
    expect(messages[0].mailboxMessageId).toBe('MSG-00001');
    expect(messages[0].subject).toBe('Test enquiry');
    expect(messages[0].ingested).toBe(false);
  });
});

describe('mock mailbox determinism', () => {
  it('mints sequential ids and resets them, so tests can assert exact values', async () => {
    await emailService.sendEnquiry({ subject: 'One', body: 'a' });
    await emailService.sendEnquiry({ subject: 'Two', body: 'b' });

    expect((await mailbox.list('front-office@test.invalid')).map((m) => m.mailboxMessageId)).toEqual([
      'MSG-00001',
      'MSG-00002',
    ]);

    await mockTransport.reset();
    await emailService.sendEnquiry({ subject: 'After reset', body: 'c' });
    expect((await mailbox.list('front-office@test.invalid'))[0].mailboxMessageId).toBe('MSG-00001');
  });

  it('preserves delivery order and supports unreadOnly filtering', async () => {
    await emailService.sendEnquiry({ subject: 'First', body: 'a' });
    await emailService.sendEnquiry({ subject: 'Second', body: 'b' });

    await mailbox.markIngested('front-office@test.invalid', 'MSG-00001');

    expect((await mailbox.list('front-office@test.invalid')).map((m) => m.subject)).toEqual(['First', 'Second']);
    expect((await mailbox.list('front-office@test.invalid', { unreadOnly: true })).map((m) => m.subject)).toEqual([
      'Second',
    ]);
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
    const res = await request(app).get('/api/v1/emails/config');
    expect(res.status).toBe(200);
    expect(res.body.transport).toBe('mock');
    expect(res.body.ipcQueryEmail).toBe('front-office@test.invalid');
    expect(res.body.inquirer.email).toBe('inquirer@test.invalid');
  });

  it('POST /emails/enquiry sends and returns the stored message', async () => {
    const res = await request(app)
      .post('/api/v1/emails/enquiry')
      .send({ subject: 'Monograph query', body: 'Details here', timestamp: '2026-08-17T09:00:00.000Z' });

    expect(res.status).toBe(201);
    expect(res.body.from).toBe('Test Inquirer <inquirer@test.invalid>');
    expect(res.body.to).toEqual(['front-office@test.invalid']);
  });

  it('POST /emails/acknowledgement sends the acknowledgement', async () => {
    const res = await request(app)
      .post('/api/v1/emails/acknowledgement')
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });

    expect(res.status).toBe(201);
    expect(res.body.subject).toContain('Acknowledgement of Query Received');
    expect(res.body.to).toEqual(['inquirer@test.invalid']);
  });

  it('rejects a response with no recipient', async () => {
    const res = await request(app).post('/api/v1/emails/response').send({ subject: 'x', body: 'y' });
    expect(res.status).toBe(400);
  });

  it('carries the query id in the acknowledgement subject, so the thread is identifiable', async () => {
    const res = await request(app)
      .post('/api/v1/emails/acknowledgement')
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00042' });

    expect(res.body.subject).toContain('[QRY-2026-00042]');
    expect(res.body.providerMessageId).toBeTruthy();
  });

  it('does not put the acknowledgement back in the IPC inbox — no ingestion loop', async () => {
    await emailService.sendEnquiry({ subject: 'Loop check', body: 'a' });
    await request(app)
      .post('/api/v1/emails/acknowledgement')
      .send({ to: 'inquirer@test.invalid', queryId: 'QRY-2026-00001' });

    // The IPC mailbox still holds only the enquiry; re-polling it can never
    // register the acknowledgement as a new query.
    const ipcInbox = await mailbox.list('front-office@test.invalid');
    expect(ipcInbox).toHaveLength(1);
    expect(ipcInbox[0].subject).toBe('Loop check');

    // It was delivered to the inquirer instead.
    const inquirerInbox = await mailbox.list('inquirer@test.invalid');
    expect(inquirerInbox).toHaveLength(1);
    expect(inquirerInbox[0].subject).toContain('Acknowledgement of Query Received');
  });
});

describe('mailbox HTTP endpoints', () => {
  it('lists messages and flags in-memory persistence', async () => {
    await emailService.sendEnquiry({ subject: 'Listed', body: 'a' });

    const res = await request(app).get('/api/v1/mailbox/messages');
    expect(res.status).toBe(200);
    expect(res.body.recipient).toBe('front-office@test.invalid');
    expect(res.body.persistence).toMatch(/cleared on backend restart/);
    expect(res.body.messages).toHaveLength(1);
  });

  it('accepts an externally-received message', async () => {
    const res = await request(app)
      .post('/api/v1/mailbox/receive')
      .send({ from: 'someone@example.com', subject: 'Direct', body: 'Arrived outside the app' });

    expect(res.status).toBe(201);
    expect(res.body.mailboxMessageId).toBe('MSG-00001');
    expect(res.body.to).toBe('front-office@test.invalid');
  });

  it('rejects a received message with no sender', async () => {
    const res = await request(app).post('/api/v1/mailbox/receive').send({ subject: 'No sender' });
    expect(res.status).toBe(400);
  });

  it('marks a message ingested and 404s for an unknown id', async () => {
    await emailService.sendEnquiry({ subject: 'To ingest', body: 'a' });

    const ok = await request(app).post('/api/v1/mailbox/messages/MSG-00001/ingested');
    expect(ok.status).toBe(200);
    expect(ok.body.ingested).toBe(true);

    const missing = await request(app).post('/api/v1/mailbox/messages/MSG-99999/ingested');
    expect(missing.status).toBe(404);
  });

  it('DELETE /mailbox clears the inbox', async () => {
    await emailService.sendEnquiry({ subject: 'Doomed', body: 'a' });
    const res = await request(app).delete('/api/v1/mailbox');
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
    expect(await mailbox.list('front-office@test.invalid')).toHaveLength(0);
  });
});
