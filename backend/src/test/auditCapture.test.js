import os from 'node:os';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));
vi.mock('../models/MailboxMessage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  Counter: (await import('./support/memoryDb.js')).memoryDb.model('Counter', { unique: ['key'] }),
}));
vi.mock('../models/User.js', async () => ({
  User: (await import('./support/memoryDb.js')).memoryDb.model('User'),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import { QueryCase, AuditEvent } from '../models/index.js';
import * as audit from '../services/audit/auditService.js';
import { diffCase } from '../services/audit/caseChanges.js';
import { present } from '../services/audit/auditPresentation.js';

const PASSWORD = 'test-pw-superadmin-0008';

const eventsOf = async (action) => (await AuditEvent.find({ action }).lean()).sort((a, b) => a.seq - b.seq);

beforeEach(() => {
  memoryDb.reset();
  audit.resetBuffer();
});

describe('sessions', () => {
  it('gives each sign-in a session ID that the person’s later events carry, through to sign-out', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'admin@ipc.example', password: PASSWORD }).expect(200);

    const [signIn] = await eventsOf(AUDIT_ACTIONS.LOGIN_SUCCEEDED);
    expect(signIn.source.sessionId).toMatch(/^SES-[0-9A-F]{8}$/);
    expect(signIn.actorName).toBe('System Administrator');
    // A request from this machine is named after this machine.
    expect(signIn.source.hostname).toBe(os.hostname());
    expect(present(signIn).deviceName).toBe(os.hostname());

    await agent.get('/api/v1/audit').expect(200);
    const [viewed] = await eventsOf(AUDIT_ACTIONS.AUDIT_VIEWED);
    expect(viewed.source.sessionId).toBe(signIn.source.sessionId);

    await agent.post('/api/v1/auth/logout').expect(200);
    const [signOut] = await eventsOf(AUDIT_ACTIONS.LOGOUT);
    expect(signOut).toMatchObject({ actorId: 'USR-0008', actorRole: ROLES.SUPER_ADMIN });
    expect(signOut.source.sessionId).toBe(signIn.source.sessionId);
    expect(present(signOut).activity).toBe('Logged out');
  });

  it('records a rejected session when an invalid one is presented, and nothing when none is', async () => {
    await request(app).get('/api/v1/audit').set('Cookie', `${authConfig.COOKIE_NAME}=forged.token.value`).expect(401);
    await request(app).get('/api/v1/audit').expect(401);

    const rejected = await eventsOf(AUDIT_ACTIONS.AUTHENTICATION_FAILED);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ result: 'denied', details: { reason: 'expired or invalid session', path: '/api/v1/audit' } });
  });

  it('records signing out without a session as nothing', async () => {
    await request(app).post('/api/v1/auth/logout').expect(200);
    expect(await eventsOf(AUDIT_ACTIONS.LOGOUT)).toHaveLength(0);
  });
});

describe('looking at the audit trail', () => {
  it('is recorded once a minute per person and filter set', async () => {
    const admin = authHeader(ROLES.ADMIN);
    await request(app).get('/api/v1/audit').set(admin);
    await request(app).get('/api/v1/audit').set(admin);
    await request(app).get('/api/v1/audit').query({ result: 'denied' }).set(admin);

    const views = await eventsOf(AUDIT_ACTIONS.AUDIT_VIEWED);
    expect(views).toHaveLength(2);
    expect(views[1].details).toMatchObject({ filters: { result: 'denied' } });
  });
});

describe('previous and new values', () => {
  it('diffs the tracked case fields', () => {
    expect(
      diffCase(
        { workflowState: 'PENDING_ASSIGNMENT', currentAssigneeId: null, category: 'analytical' },
        { workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0004', category: 'analytical', subject: 'x' },
      ),
    ).toEqual({ status: { from: 'PENDING_ASSIGNMENT', to: 'ASSIGNED' }, assignee: { from: null, to: 'USR-0004' } });
    expect(diffCase({ workflowState: 'DRAFTING' }, { workflowState: 'DRAFTING' })).toBeNull();
  });

  it('records the old and new status and assignee when a case is saved', async () => {
    await QueryCase.create({
      queryId: 'QRY-2026-00007',
      subject: 'Dissolution',
      workflowState: 'PENDING_ASSIGNMENT',
      businessStatus: 'IN_PROGRESS',
      currentAssigneeId: null,
      createdAt: '2026-09-18T09:00:00.000Z',
    });

    await request(app)
      .post('/api/v1/queries/persist')
      .set(authHeader(ROLES.SUPER_ADMIN))
      .send({
        query: { queryId: 'QRY-2026-00007', workflowState: 'ASSIGNED', currentAssigneeId: 'USR-0004', createdAt: '2026-09-18T09:00:00.000Z' },
        baseRevision: 0,
        auditEvent: { auditId: 'AUD-X1', event: 'QUERY_ASSIGNED', queryId: 'QRY-2026-00007', details: 'Assigned to Neha Singh.' },
      })
      .expect(200);

    const [assigned] = await eventsOf('QUERY_ASSIGNED');
    expect(assigned.changes).toEqual({
      status: { from: 'PENDING_ASSIGNMENT', to: 'ASSIGNED' },
      assignee: { from: null, to: 'USR-0004' },
    });
    expect(present(assigned)).toMatchObject({
      previousValue: 'Status: Waiting to be given to an officer; Assignee: Unassigned',
      newValue: 'Status: With an officer; Assignee: Neha Singh',
    });
  });

  it('keeps events recorded before these fields existed verifiable', async () => {
    await audit.record({ action: AUDIT_ACTIONS.EMAIL_SENT, actorType: 'system' });
    await audit.record({ action: 'QUERY_ASSIGNED', actorType: 'human', changes: { status: { from: 'A', to: 'B' } } });
    expect((await audit.verifyChain()).ok).toBe(true);
  });
});

describe('the report reference', () => {
  it('numbers reports per month', async () => {
    expect(await audit.nextReportReference('2026-10-01T06:00:00.000Z')).toBe('BRIDGETECH/ATR/2026-10/001');
    expect(await audit.nextReportReference('2026-10-02T06:00:00.000Z')).toBe('BRIDGETECH/ATR/2026-10/002');
    expect(await audit.nextReportReference('2026-11-01T06:00:00.000Z')).toBe('BRIDGETECH/ATR/2026-11/001');
  });
});

describe('device names', () => {
  it('are looked up once per address, and missing ones stay empty', async () => {
    const { resolveHostname, clearHostnameCache } = await import('../services/audit/hostLookup.js');
    clearHostnameCache();
    expect(await resolveHostname('127.0.0.1')).toBe(os.hostname());
    expect(await resolveHostname('')).toBeNull();
    expect(await resolveHostname('203.0.113.250')).toBeNull();
  });

  it('are filled in for display on older events that lack one', async () => {
    const [shown] = await audit.withDeviceNames([{ action: 'EMAIL_SENT', source: { ip: '127.0.0.1' } }]);
    expect(shown.source.hostname).toBe(os.hostname());
  });
});
