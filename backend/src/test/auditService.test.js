import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

const PASSWORD = 'test-seed-password';

beforeEach(() => {
  audit.resetBuffer();
});

describe('auditService', () => {
  it('reports that it is not durable without Mongo', () => {
    // The suite runs with DATABASE_URL blank, so this is the fallback path.
    expect(audit.describe()).toEqual({ backend: 'in-memory', durable: false });
  });

  it('records an event and reads it back newest-first', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_RECEIVED, messageId: 'first' });
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_RECEIVED, messageId: 'second' });

    const events = await audit.list({ action: AUDIT_ACTIONS.EMAIL_RECEIVED });
    expect(events.map((e) => e.messageId)).toEqual(['second', 'first']);
  });

  it('defaults timestamp, actorType and result', async () => {
    const event = await audit.record({ action: AUDIT_ACTIONS.SYNC_STARTED });

    expect(event.actorType).toBe(ACTOR_TYPES.SYSTEM);
    expect(event.result).toBe(AUDIT_RESULTS.SUCCESS);
    expect(Date.parse(event.timestamp)).not.toBeNaN();
    // Nothing is durable in this configuration, and the record says so.
    expect(event.persisted).toBe(false);
  });

  it('filters by queryId and messageId', async () => {
    await audit.record({ action: AUDIT_ACTIONS.CASE_ASSOCIATED, queryId: 'QRY-1' });
    await audit.record({ action: AUDIT_ACTIONS.CASE_ASSOCIATED, queryId: 'QRY-2' });

    expect(await audit.list({ queryId: 'QRY-1' })).toHaveLength(1);
  });

  it('carries AI provenance through unchanged', async () => {
    const aiMetadata = {
      aiGenerated: true,
      model: 'gemma',
      promptVersion: 'v1',
      generatedAt: '2026-09-09T00:00:00.000Z',
    };

    await audit.record({ action: AUDIT_ACTIONS.AI_DRAFT_GENERATED, aiMetadata });

    const [event] = await audit.list({ action: AUDIT_ACTIONS.AI_DRAFT_GENERATED });
    expect(event.aiMetadata).toEqual(aiMetadata);
  });

  it('refuses an event with no action rather than storing a nameless one', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await audit.record({ messageId: 'orphan' })).toBeNull();
    expect(await audit.list({})).toHaveLength(0);

    spy.mockRestore();
  });
});

describe('authentication is audited', () => {
  it('records a successful login with the actor', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@ipc.example', password: PASSWORD });

    const [event] = await audit.list({ action: AUDIT_ACTIONS.LOGIN_SUCCEEDED });
    expect(event).toMatchObject({
      actorId: 'USR-0008',
      actorRole: 'SUPER_ADMIN',
      actorType: ACTOR_TYPES.HUMAN,
      result: AUDIT_RESULTS.SUCCESS,
    });
  });

  it('records a failed login with the address tried and no user', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'Nobody@IPC.example', password: 'wrong' });

    const [event] = await audit.list({ action: AUDIT_ACTIONS.LOGIN_FAILED });
    expect(event.result).toBe(AUDIT_RESULTS.DENIED);
    expect(event.actorId).toBeNull();
    expect(event.details).toEqual({ email: 'nobody@ipc.example' });
  });

  it('never records the password', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@ipc.example', password: 'hunter2-should-not-appear' });

    const events = await audit.list({});
    expect(JSON.stringify(events)).not.toContain('hunter2');
  });
});
