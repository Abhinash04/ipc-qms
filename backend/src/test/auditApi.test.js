import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader, AUTH } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import * as audit from '../services/audit/auditService.js';
import * as store from '../services/attachments/attachmentStore.js';

/**
 * The audit read API is what makes the Administration console real rather than
 * decorative, so these tests assert two things: that the endpoints are
 * administrator-only, and that real actions actually land in the trail.
 */

const ADMIN = authHeader(ROLES.ADMIN);

beforeEach(async () => {
  audit.resetBuffer();
  await store.reset();
});

describe('GET /audit is administrator-only', () => {
  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/v1/audit')).status).toBe(401);
  });

  it.each([
    ['FRONT_OFFICE', ROLES.FRONT_OFFICE],
    ['OFFICER_IN_CHARGE', ROLES.OFFICER_IN_CHARGE],
    ['REVIEWER', ROLES.REVIEWER],
  ])('refuses %s — the trail is not an operational view', async (_label, role) => {
    const res = await request(app).get('/api/v1/audit').set(authHeader(role));
    expect(res.status).toBe(403);
  });

  it.each([
    ['ADMIN', ROLES.ADMIN],
    ['SUPER_ADMIN', ROLES.SUPER_ADMIN],
  ])('allows %s', async (_label, role) => {
    const res = await request(app).get('/api/v1/audit').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('guards the summary and per-query endpoints the same way', async () => {
    expect((await request(app).get('/api/v1/audit/summary')).status).toBe(401);
    expect((await request(app).get('/api/v1/audit/summary').set(authHeader(ROLES.REVIEWER))).status).toBe(403);
    expect((await request(app).get('/api/v1/audit/summary').set(ADMIN)).status).toBe(200);

    expect((await request(app).get('/api/v1/audit/query/QRY-1').set(authHeader(ROLES.REVIEWER))).status).toBe(403);
    expect((await request(app).get('/api/v1/audit/query/QRY-1').set(ADMIN)).status).toBe(200);
  });
});

describe('the trail reports what the server actually did', () => {
  it('records a forward, with the case id and attachment count', async () => {
    const res = await request(app)
      .post('/api/v1/emails/forward')
      .set(AUTH)
      .send({ queryId: 'QRY-2026-00042', subject: 'Sterility clarification', body: 'body' });
    expect(res.status).toBe(201);

    const trail = await request(app).get('/api/v1/audit').set(ADMIN);
    const forwarded = trail.body.events.find((e) => e.action === AUDIT_ACTIONS.EMAIL_FORWARDED);

    expect(forwarded).toBeTruthy();
    expect(forwarded.queryId).toBe('QRY-2026-00042');
    expect(forwarded.result).toBe(AUDIT_RESULTS.SUCCESS);
    expect(forwarded.details.attachments).toBe(0);
  });

  it('records an AI call with latency and whether it fell back', async () => {
    // GEMMA_API_URL is blank in the suite, so every AI call takes the
    // deterministic fallback — which is exactly the case worth proving is
    // visible, because it is silent everywhere else.
    const res = await request(app)
      .post('/api/v1/ai/summary')
      .set(AUTH)
      .send({ subject: 'Impurity limits', body: 'Please clarify the limits.' });
    expect(res.status).toBe(200);

    const trail = await request(app).get('/api/v1/audit').set(ADMIN);
    const ai = trail.body.events.find((e) => e.action === AUDIT_ACTIONS.AI_SUMMARY_GENERATED);

    expect(ai).toBeTruthy();
    expect(ai.aiMetadata.fallback).toBe(true);
    expect(ai.aiMetadata.aiGenerated).toBe(false);
    expect(typeof ai.aiMetadata.latencyMs).toBe('number');
  });

  it('records an attachment upload and download against the actor', async () => {
    const upload = await request(app)
      .post('/api/v1/attachments')
      .set(AUTH)
      .attach('files', Buffer.from('%PDF-1.4 audit me'), { filename: 'spec.pdf', contentType: 'application/pdf' });
    const { attachmentId } = upload.body.attachments[0];

    await request(app).get(`/api/v1/attachments/${attachmentId}`).set(AUTH);

    const trail = await request(app).get('/api/v1/audit').set(ADMIN);
    const uploaded = trail.body.events.find((e) => e.action === AUDIT_ACTIONS.ATTACHMENT_UPLOADED);
    const downloaded = trail.body.events.find((e) => e.action === AUDIT_ACTIONS.ATTACHMENT_DOWNLOADED);

    expect(uploaded.attachmentId).toBe(attachmentId);
    expect(uploaded.details.filename).toBe('spec.pdf');
    expect(downloaded.attachmentId).toBe(attachmentId);
  });

  it('records a refused request, which is what an escalation attempt looks like', async () => {
    await request(app).delete('/api/v1/mailbox').set(authHeader(ROLES.ASSIGNED_OFFICIAL));

    const trail = await request(app).get('/api/v1/audit').set(ADMIN);
    const denied = trail.body.events.find((e) => e.action === AUDIT_ACTIONS.AUTHORIZATION_DENIED);

    expect(denied).toBeTruthy();
    expect(denied.result).toBe(AUDIT_RESULTS.DENIED);
    expect(denied.actorRole).toBe(ROLES.ASSIGNED_OFFICIAL);
    expect(denied.details.path).toContain('/mailbox');
  });

  it('never puts a credential or a message body in the trail', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@ipc.example', password: 'test-seed-password' });
    await request(app)
      .post('/api/v1/emails/forward')
      .set(AUTH)
      .send({ queryId: 'QRY-1', subject: 'Secret subject', body: 'CONFIDENTIAL BODY TEXT' });

    const trail = await request(app).get('/api/v1/audit').set(ADMIN);
    const serialised = JSON.stringify(trail.body);

    expect(serialised).not.toContain('test-seed-password');
    expect(serialised).not.toContain('CONFIDENTIAL BODY TEXT');
  });
});

describe('filtering and aggregation', () => {
  beforeEach(async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, queryId: 'QRY-A', result: AUDIT_RESULTS.SUCCESS });
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, queryId: 'QRY-B', result: AUDIT_RESULTS.SUCCESS });
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, queryId: 'QRY-A', result: AUDIT_RESULTS.FAILURE });
  });

  it('filters by action', async () => {
    const res = await request(app).get('/api/v1/audit?action=EMAIL_SENT').set(ADMIN);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events.every((e) => e.action === 'EMAIL_SENT')).toBe(true);
  });

  it('filters by query id', async () => {
    const res = await request(app).get('/api/v1/audit?queryId=QRY-A').set(ADMIN);
    expect(res.body.events).toHaveLength(2);
  });

  it('filters by result, so failures can be found on their own', async () => {
    const res = await request(app).get('/api/v1/audit?result=failure').set(ADMIN);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].action).toBe('EMAIL_SEND_FAILED');
  });

  it('excludes events outside a date range', async () => {
    const res = await request(app).get('/api/v1/audit?from=2099-01-01T00:00:00.000Z').set(ADMIN);
    expect(res.body.events).toHaveLength(0);
  });

  it('pages with limit and offset', async () => {
    const first = await request(app).get('/api/v1/audit?limit=2').set(ADMIN);
    const second = await request(app).get('/api/v1/audit?limit=2&offset=2').set(ADMIN);

    expect(first.body.events).toHaveLength(2);
    expect(second.body.events).toHaveLength(1);
    expect(first.body.events[0].timestamp >= first.body.events[1].timestamp).toBe(true);
  });

  it('summarises counts by action and result, plus a today window', async () => {
    const res = await request(app).get('/api/v1/audit/summary').set(ADMIN);

    expect(res.body.overall.total).toBe(3);
    expect(res.body.overall.byAction.EMAIL_SENT).toBe(2);
    expect(res.body.overall.byResult.failure).toBe(1);
    // Everything above was recorded moments ago, so "today" sees all of it.
    expect(res.body.today.total).toBe(3);
    expect(typeof res.body.overall.durable).toBe('boolean');
  });

  it('returns one case history oldest-first, for a timeline', async () => {
    const res = await request(app).get('/api/v1/audit/query/QRY-A').set(ADMIN);

    expect(res.body.queryId).toBe('QRY-A');
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].timestamp <= res.body.events[1].timestamp).toBe(true);
  });
});
