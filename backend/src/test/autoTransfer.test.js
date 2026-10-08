import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/WorkflowStep.js', async () => ({
  WorkflowStep: (await import('./support/memoryDb.js')).memoryDb.model('WorkflowStep', { unique: ['stepId'] }),
}));
vi.mock('../models/Review.js', async () => ({
  Review: (await import('./support/memoryDb.js')).memoryDb.model('Review', { unique: ['reviewId'] }),
}));
vi.mock('../models/ResponseVersion.js', async () => ({
  ResponseVersion: (await import('./support/memoryDb.js')).memoryDb.model('ResponseVersion', { unique: ['responseId'] }),
}));
vi.mock('../models/Notification.js', async () => ({
  Notification: (await import('./support/memoryDb.js')).memoryDb.model('Notification', { unique: ['notificationId'] }),
}));
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage', { unique: ['messageId'] }),
}));
vi.mock('../models/EmailThread.js', async () => ({
  EmailThread: (await import('./support/memoryDb.js')).memoryDb.model('EmailThread', { unique: ['threadId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../models/OutboundEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  OutboundEmail: (await import('./support/memoryDb.js')).memoryDb.model('OutboundEmail', { unique: ['dispatchKey'] }),
}));
vi.mock('../models/QueryCounter.js', async () => ({
  QueryCounter: (await import('./support/memoryDb.js')).memoryDb.model('QueryCounter'),
}));
vi.mock('../services/ai/gemmaService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recommendOfficial: vi.fn(),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import env from '../config/env.js';
import authConfig from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import { USERS } from '../constants/users.js';
import { QueryCase, Notification, AuditEvent, EmailMessage } from '../models/index.js';
import * as gemmaService from '../services/ai/gemmaService.js';
import { autoTransferSettings } from '../services/query/assignmentClock.js';
import {
  executeAutoTransfer,
  processExpiredTransfers,
  startAutoTransferScheduler,
  stopAutoTransferScheduler,
} from '../services/query/autoTransferScheduler.js';

const CASE = 'QRY-2026-00042';
const byId = (id) => USERS.find((user) => user.id === id);
const OIC = byId('USR-0003');
const OFFICER_A = byId('USR-0004');
const OFFICER_B = byId('USR-0010');
const OFFICER_C = byId('USR-0011');
const OFFICER_D = byId('USR-0012');
const REVIEWER = byId('USR-0005');

const RANKING = [
  { userId: OFFICER_A.id, matchPercent: 98 },
  { userId: OFFICER_B.id, matchPercent: 80 },
  { userId: OFFICER_C.id, matchPercent: 72 },
  { userId: OFFICER_D.id, matchPercent: 65 },
];

const MINUTE = 60 * 1000;
const ORIGINAL = {
  enabled: env.QUERY_AUTO_TRANSFER_ENABLED,
  scheduler: env.QUERY_AUTO_TRANSFER_SCHEDULER,
  timeout: env.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES,
  interval: env.QUERY_AUTO_TRANSFER_INTERVAL_SECONDS,
};

const cookieFor = (user) => ({ Cookie: `${authConfig.COOKIE_NAME}=${signToken(user)}` });
const persistAs = (user, body) => request(app).post('/api/v1/queries/persist').set(cookieFor(user)).send(body);
const stored = () => QueryCase.findOne({ queryId: CASE }).lean();
const settings = () => autoTransferSettings(env);
const sweep = (at, options = {}) => processExpiredTransfers({ now: at, settings: settings(), ...options });
const after = (iso, ms = 1000) => Date.parse(iso) + ms;
let auditSeq = 0;

const caseRow = (overrides = {}) => ({
  queryId: CASE,
  subject: 'Assay limits for a modified-release tablet',
  description: 'Please clarify the assay limit.',
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState: 'PENDING_ASSIGNMENT',
  businessStatus: 'IN_PROGRESS',
  currentAssigneeId: null,
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
  ...overrides,
});

async function transition(user, patch, event, details = '') {
  const current = await stored();
  auditSeq += 1;
  const res = await persistAs(user, {
    query: { ...caseRow(), ...stripServerFields(current), ...patch },
    baseRevision: current?.revision ?? 0,
    auditEvent: { auditId: `AUD-T-${auditSeq}`, event, queryId: CASE, details },
  });
  expect(res.status).toBe(200);
  return stored();
}

function stripServerFields(doc) {
  if (!doc) return {};
  const { _id, revision, ...rest } = doc;
  return rest;
}

async function openCase(overrides = {}) {
  const res = await persistAs(OIC, { query: caseRow(overrides) });
  expect(res.status).toBe(200);
}

async function assignTo(officer, ranking = RANKING) {
  await openCase();
  return transition(
    OIC,
    {
      workflowState: 'ASSIGNED',
      currentAssigneeId: officer.id,
      assignmentDecision: { assigneeId: officer.id, acceptedAiRecommendation: true, ranking },
    },
    'QUERY_ASSIGNED',
    `Assigned to ${officer.name}.`,
  );
}

const auditOf = async (action) => (await AuditEvent.find({ action }).lean()).filter((row) => row.queryId === CASE);

beforeEach(() => {
  memoryDb.reset();
  env.QUERY_AUTO_TRANSFER_ENABLED = true;
  env.QUERY_AUTO_TRANSFER_SCHEDULER = false;
  env.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES = 2;
  env.QUERY_AUTO_TRANSFER_INTERVAL_SECONDS = 10;
  vi.mocked(gemmaService.recommendOfficial).mockReset();
  vi.mocked(gemmaService.recommendOfficial).mockResolvedValue([]);
});

afterEach(() => {
  env.QUERY_AUTO_TRANSFER_ENABLED = ORIGINAL.enabled;
  env.QUERY_AUTO_TRANSFER_SCHEDULER = ORIGINAL.scheduler;
  env.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES = ORIGINAL.timeout;
  env.QUERY_AUTO_TRANSFER_INTERVAL_SECONDS = ORIGINAL.interval;
  stopAutoTransferScheduler();
});

describe('1-2. sequential transfers follow the AI recommendation order', () => {
  it('moves the case A → B after the limit, then B → C after another limit', async () => {
    const assigned = await assignTo(OFFICER_A);
    expect(assigned.actionDeadline).toBe(new Date(Date.parse(assigned.assignedAt) + 2 * MINUTE).toISOString());

    const first = await sweep(after(assigned.actionDeadline));
    expect(first).toMatchObject({ ran: true, transferred: 1 });
    const atB = await stored();
    expect(atB.currentAssigneeId).toBe(OFFICER_B.id);
    expect(atB.workflowState).toBe('ASSIGNED');
    expect(Date.parse(atB.actionDeadline) - Date.parse(atB.assignedAt)).toBe(2 * MINUTE);

    await sweep(after(atB.actionDeadline));
    const atC = await stored();
    expect(atC.currentAssigneeId).toBe(OFFICER_C.id);
    expect(atC.autoTransferCount).toBe(2);
    expect(atC.transferHistory.map((t) => [t.fromAssigneeId, t.toAssigneeId, t.transferType])).toEqual([
      [OFFICER_A.id, OFFICER_B.id, 'AUTO_TRANSFER'],
      [OFFICER_B.id, OFFICER_C.id, 'AUTO_TRANSFER'],
    ]);

    await sweep(after(atC.actionDeadline));
    expect((await stored()).currentAssigneeId).toBe(OFFICER_D.id);
  });

  it('records each automatic transfer in the case history and notifies the new officer, with no email record', async () => {
    const assigned = await assignTo(OFFICER_A);
    await sweep(after(assigned.actionDeadline));

    const rows = await auditOf('QUERY_AUTO_TRANSFERRED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: 'system', actorRole: 'SYSTEM' });
    expect(rows[0].details).toContain(`Transferred From: ${OFFICER_A.name}`);
    expect(rows[0].details).toContain(`Transferred To: ${OFFICER_B.name}`);
    expect(rows[0].details).toContain('AI Match: 80%');
    expect(rows[0].changes).toEqual({ assignee: { from: OFFICER_A.id, to: OFFICER_B.id } });

    const notes = await Notification.find({ queryId: CASE, recipientUserId: OFFICER_B.id }).lean();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Query automatically transferred to you');

    expect(await EmailMessage.find({ queryId: CASE }).lean()).toEqual([]);

    const history = await request(app).get('/api/v1/queries').set(cookieFor(OIC));
    expect(history.body.auditEvents.some((e) => e.queryId === CASE && e.event === 'QUERY_AUTO_TRANSFERRED')).toBe(true);
  });

  it('ranks by match percentage even when the list arrives unsorted', async () => {
    const shuffled = [RANKING[2], RANKING[0], RANKING[3], RANKING[1]];
    const assigned = await assignTo(OFFICER_A, shuffled);
    await sweep(after(assigned.actionDeadline));
    expect((await stored()).currentAssigneeId).toBe(OFFICER_B.id);
  });

  it('asks the recommender when the OIC assigned without a ranking, and keeps that order', async () => {
    vi.mocked(gemmaService.recommendOfficial).mockResolvedValue([
      { userId: OFFICER_A.id, matchPercent: 90 },
      { userId: OFFICER_D.id, matchPercent: 85 },
      { userId: OFFICER_C.id, matchPercent: 60 },
    ]);
    const assigned = await assignTo(OFFICER_A, null);
    expect(assigned.autoTransferRanking).toEqual([]);

    await sweep(after(assigned.actionDeadline));
    const moved = await stored();
    expect(moved.currentAssigneeId).toBe(OFFICER_D.id);
    expect(moved.autoTransferRanking.map((r) => r.userId)).toEqual([OFFICER_A.id, OFFICER_D.id, OFFICER_C.id]);

    await sweep(after(moved.actionDeadline));
    expect((await stored()).currentAssigneeId).toBe(OFFICER_C.id);
    expect(gemmaService.recommendOfficial).toHaveBeenCalledTimes(1);
  });
});

describe('3. taking action stops the countdown', () => {
  it('never transfers once the assignee starts drafting', async () => {
    await assignTo(OFFICER_A);
    const drafting = await transition(OFFICER_A, { workflowState: 'DRAFTING' }, 'DRAFT_GENERATED');
    expect(drafting.actionDeadline).toBeNull();

    const result = await sweep(Date.now() + 60 * MINUTE);
    expect(result.transferred).toBe(0);
    const after_ = await stored();
    expect(after_.currentAssigneeId).toBe(OFFICER_A.id);
    expect(after_.workflowState).toBe('DRAFTING');
  });

  it('does not reset or extend the countdown on unrelated saves while the case stays assigned', async () => {
    const assigned = await assignTo(OFFICER_A);
    const saved = await transition(OIC, { description: 'Updated description' }, 'QUERY_ASSIGNED');
    expect(saved.assignedAt).toBe(assigned.assignedAt);
    expect(saved.actionDeadline).toBe(assigned.actionDeadline);
  });
});

describe('4. an officer who already held the case is never picked again', () => {
  it('skips every officer earlier in the chain', async () => {
    const assigned = await assignTo(OFFICER_A);
    await sweep(after(assigned.actionDeadline));
    const atB = await stored();
    await sweep(after(atB.actionDeadline));
    const atC = await stored();
    await sweep(after(atC.actionDeadline));
    const atD = await stored();

    expect(atD.currentAssigneeId).toBe(OFFICER_D.id);
    expect(atD.autoTransferHeldIds).toEqual([OFFICER_A.id, OFFICER_B.id, OFFICER_C.id, OFFICER_D.id]);
  });
});

describe('5-6. manual transfers keep working and restart the clock', () => {
  it('lets the assignee transfer manually, records it, and gives the new officer a fresh limit', async () => {
    await assignTo(OFFICER_A);
    const before = Date.now();
    const moved = await transition(
      OFFICER_A,
      { currentAssigneeId: OFFICER_C.id },
      'QUERY_TRANSFERRED',
      `Case ID: ${CASE} | Transferred From: ${OFFICER_A.name} | Transferred To: ${OFFICER_C.name} | Transferred By: ${OFFICER_A.name} | Reason: On leave`,
    );

    expect(moved.currentAssigneeId).toBe(OFFICER_C.id);
    expect(Date.parse(moved.assignedAt)).toBeGreaterThanOrEqual(before);
    expect(moved.actionDeadline).toBe(new Date(Date.parse(moved.assignedAt) + 2 * MINUTE).toISOString());
    expect(moved.transferType).toBe('MANUAL');
    expect(moved.transferHistory).toEqual([
      expect.objectContaining({
        fromAssigneeId: OFFICER_A.id,
        toAssigneeId: OFFICER_C.id,
        transferType: 'MANUAL',
        reason: 'On leave',
        byUserId: OFFICER_A.id,
      }),
    ]);

    const manual = await auditOf('QUERY_TRANSFERRED');
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ actorId: OFFICER_A.id, actorType: 'human' });

    await sweep(after(moved.actionDeadline));
    expect((await stored()).currentAssigneeId).toBe(OFFICER_B.id);
  });

  it('still refuses a manual transfer by someone who is not the assignee', async () => {
    await assignTo(OFFICER_A);
    const current = await stored();
    const res = await persistAs(OFFICER_B, {
      query: { ...stripServerFields(current), currentAssigneeId: OFFICER_B.id },
      baseRevision: current.revision,
      auditEvent: { auditId: 'AUD-X', event: 'QUERY_TRANSFERRED', queryId: CASE },
    });
    expect(res.status).toBe(403);
    expect((await stored()).currentAssigneeId).toBe(OFFICER_A.id);
  });
});

describe('7-8. only live assignments with a server deadline are eligible', () => {
  it('never transfers a case that has left the ASSIGNED stage, even with a stale deadline', async () => {
    for (const workflowState of ['DRAFTING', 'UNDER_REVIEW', 'PENDING_FINAL_APPROVAL', 'CLOSED']) {
      memoryDb.reset();
      await QueryCase.create({
        ...caseRow({ workflowState, currentAssigneeId: OFFICER_A.id }),
        actionDeadline: '2026-09-18T09:02:00.000Z',
        autoTransferRanking: RANKING,
        revision: 1,
      });
      const result = await sweep(Date.now());
      expect(result.transferred).toBe(0);
      expect((await stored()).currentAssigneeId).toBe(OFFICER_A.id);
    }
  });

  it('leaves older assigned cases without a deadline alone', async () => {
    await QueryCase.create({
      ...caseRow({ workflowState: 'ASSIGNED', currentAssigneeId: OFFICER_A.id }),
      createdAt: '2026-01-01T00:00:00.000Z',
      revision: 3,
    });

    const result = await sweep(Date.now() + 24 * 60 * MINUTE);
    expect(result).toMatchObject({ scanned: 0, transferred: 0 });
    const untouched = await stored();
    expect(untouched.currentAssigneeId).toBe(OFFICER_A.id);
    expect(untouched.actionDeadline ?? null).toBeNull();
    expect(untouched.assignedAt ?? null).toBeNull();
    expect(await auditOf('QUERY_AUTO_TRANSFERRED')).toEqual([]);
  });

  it('does not start a countdown on an older assigned case just because it is saved', async () => {
    await QueryCase.create({
      ...caseRow({ workflowState: 'ASSIGNED', currentAssigneeId: OFFICER_A.id }),
      revision: 3,
    });
    const saved = await transition(OIC, { description: 'Clarified' }, 'QUERY_ASSIGNED');
    expect(saved.actionDeadline ?? null).toBeNull();
  });
});

describe('9. unavailable or ineligible officers are skipped', () => {
  it('skips unknown users, non-officials and inactive officials', async () => {
    const inactive = { id: 'USR-0099', name: 'Inactive Official', role: 'ASSIGNED_OFFICIAL', active: false };
    const assigned = await assignTo(OFFICER_A, [
      { userId: OFFICER_A.id, matchPercent: 99 },
      { userId: 'USR-9999', matchPercent: 95 },
      { userId: REVIEWER.id, matchPercent: 90 },
      { userId: inactive.id, matchPercent: 85 },
      { userId: OFFICER_C.id, matchPercent: 50 },
    ]);

    await sweep(after(assigned.actionDeadline), { directory: [...USERS, inactive] });
    expect((await stored()).currentAssigneeId).toBe(OFFICER_C.id);
  });
});

describe('10. when nobody eligible remains', () => {
  it('stops, records the failure once, and tells the OIC', async () => {
    const assigned = await assignTo(OFFICER_A, RANKING.slice(0, 2));
    await sweep(after(assigned.actionDeadline));
    const atB = await stored();

    const result = await sweep(after(atB.actionDeadline));
    expect(result).toMatchObject({ transferred: 0, exhausted: 1 });

    const failed = await stored();
    expect(failed.currentAssigneeId).toBe(OFFICER_B.id);
    expect(failed.autoTransferFailed).toBe(true);
    expect(failed.actionDeadline).toBeNull();

    await sweep(after(atB.actionDeadline, 30 * MINUTE));
    expect(await auditOf('QUERY_AUTO_TRANSFER_FAILED')).toHaveLength(1);
    const warnings = await Notification.find({ queryId: CASE, recipientRole: 'OFFICER_IN_CHARGE' }).lean();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('WARNING');
  });
});

describe('11. concurrent sweeps transfer a case once', () => {
  it('lets only one of two simultaneous sweeps move the case', async () => {
    const assigned = await assignTo(OFFICER_A);
    const at = after(assigned.actionDeadline);

    const [one, two] = await Promise.all([sweep(at), sweep(at)]);
    expect(one.transferred + two.transferred).toBe(1);

    const moved = await stored();
    expect(moved.currentAssigneeId).toBe(OFFICER_B.id);
    expect(moved.autoTransferCount).toBe(1);
    expect(moved.transferHistory).toHaveLength(1);
    expect(await auditOf('QUERY_AUTO_TRANSFERRED')).toHaveLength(1);
  });

  it('refuses a second transfer attempt from a stale snapshot', async () => {
    const assigned = await assignTo(OFFICER_A);
    const snapshot = await stored();
    const at = after(assigned.actionDeadline);

    const first = await executeAutoTransfer(snapshot, { now: at, settings: settings() });
    const second = await executeAutoTransfer(snapshot, { now: at, settings: settings() });
    expect(first.outcome).toBe('TRANSFERRED');
    expect(second).toMatchObject({ outcome: 'SKIPPED', reason: 'CASE_CHANGED' });
  });
});

describe('12. the manual trigger is restricted', () => {
  it.each([
    ['an assigned official', OFFICER_A],
    ['a reviewer', REVIEWER],
    ['the front office', { id: 'USR-TEST-FO', name: 'FO', role: 'FRONT_OFFICE', email: 'fo@test.invalid' }],
  ])('refuses %s', async (_label, user) => {
    const res = await request(app).post('/api/v1/queries/auto-transfer-check').set(cookieFor(user));
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).post('/api/v1/queries/auto-transfer-check');
    expect(res.status).toBe(401);
  });

  it('lets the OIC run a sweep, which transfers only genuinely expired cases', async () => {
    await assignTo(OFFICER_A);
    const early = await request(app).post('/api/v1/queries/auto-transfer-check').set(cookieFor(OIC));
    expect(early.status).toBe(200);
    expect(early.body).toMatchObject({ ran: true, transferred: 0 });
    expect((await stored()).currentAssigneeId).toBe(OFFICER_A.id);
  });
});

describe('13. the configured limit is the only limit', () => {
  it('uses QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES for every deadline', async () => {
    env.QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES = 5;
    const assigned = await assignTo(OFFICER_A);
    expect(Date.parse(assigned.actionDeadline) - Date.parse(assigned.assignedAt)).toBe(5 * MINUTE);

    expect((await sweep(Date.parse(assigned.assignedAt) + 2 * MINUTE + 1000)).transferred).toBe(0);
    expect((await sweep(after(assigned.actionDeadline))).transferred).toBe(1);
    const moved = await stored();
    expect(Date.parse(moved.actionDeadline) - Date.parse(moved.assignedAt)).toBe(5 * MINUTE);
  });

  it('ignores deadlines, counters and history sent by the browser', async () => {
    await openCase();
    const current = await stored();
    const res = await persistAs(OIC, {
      query: {
        ...stripServerFields(current),
        workflowState: 'ASSIGNED',
        currentAssigneeId: OFFICER_A.id,
        assignmentDecision: { assigneeId: OFFICER_A.id, ranking: RANKING },
        actionDeadline: '2099-01-01T00:00:00.000Z',
        assignedAt: '2099-01-01T00:00:00.000Z',
        autoTransferCount: 99,
        autoTransferFailed: true,
        transferHistory: [{ fromAssigneeId: 'x', toAssigneeId: 'y' }],
        autoTransferHeldIds: [OFFICER_B.id, OFFICER_C.id],
      },
      baseRevision: current.revision,
      auditEvent: { auditId: 'AUD-FORGE', event: 'QUERY_ASSIGNED', queryId: CASE },
    });
    expect(res.status).toBe(200);

    const saved = await stored();
    expect(saved.actionDeadline).not.toBe('2099-01-01T00:00:00.000Z');
    expect(Date.parse(saved.actionDeadline) - Date.parse(saved.assignedAt)).toBe(2 * MINUTE);
    expect(saved.autoTransferCount).toBe(0);
    expect(saved.autoTransferFailed).toBe(false);
    expect(saved.transferHistory ?? []).toEqual([]);
    expect(saved.autoTransferHeldIds).toEqual([OFFICER_A.id]);
  });

  it('refuses an automatic-transfer audit event sent by a browser', async () => {
    await assignTo(OFFICER_A);
    const current = await stored();
    const res = await persistAs(OIC, {
      query: stripServerFields(current),
      baseRevision: current.revision,
      auditEvent: { auditId: 'AUD-FAKE-AUTO', event: 'QUERY_AUTO_TRANSFERRED', queryId: CASE },
    });
    expect(res.status).toBe(200);
    expect(await auditOf('QUERY_AUTO_TRANSFERRED')).toEqual([]);
  });
});

describe('14. switching the feature off', () => {
  it('stamps no deadline and transfers nothing when disabled', async () => {
    env.QUERY_AUTO_TRANSFER_ENABLED = false;
    const assigned = await assignTo(OFFICER_A);
    expect(assigned.actionDeadline).toBeNull();

    const result = await sweep(Date.now() + 60 * MINUTE);
    expect(result).toMatchObject({ ran: false, reason: 'DISABLED' });
    expect((await stored()).currentAssigneeId).toBe(OFFICER_A.id);
  });

  it('stops sweeping an existing deadline once disabled', async () => {
    const assigned = await assignTo(OFFICER_A);
    env.QUERY_AUTO_TRANSFER_ENABLED = false;
    const result = await sweep(after(assigned.actionDeadline));
    expect(result.ran).toBe(false);
    expect((await stored()).currentAssigneeId).toBe(OFFICER_A.id);
  });

  it('starts the scheduler only where it is explicitly switched on, never under tests', () => {
    const base = { ...env, QUERY_AUTO_TRANSFER_ENABLED: true, QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES: 2, QUERY_AUTO_TRANSFER_INTERVAL_SECONDS: 10 };
    expect(startAutoTransferScheduler({ config: { ...base, NODE_ENV: 'test', QUERY_AUTO_TRANSFER_SCHEDULER: true } })).toBeNull();
    expect(startAutoTransferScheduler({ config: { ...base, NODE_ENV: 'development', QUERY_AUTO_TRANSFER_SCHEDULER: false } })).toBeNull();
    expect(
      startAutoTransferScheduler({ config: { ...base, NODE_ENV: 'development', QUERY_AUTO_TRANSFER_ENABLED: false, QUERY_AUTO_TRANSFER_SCHEDULER: true } }),
    ).toBeNull();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const started = startAutoTransferScheduler({ config: { ...base, NODE_ENV: 'development', QUERY_AUTO_TRANSFER_SCHEDULER: true } });
    expect(started).not.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2-minute action limit'));
    stopAutoTransferScheduler();
    log.mockRestore();
  });

  it('refuses a nonsensical limit instead of transferring every few seconds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = { ...env, NODE_ENV: 'development', QUERY_AUTO_TRANSFER_ENABLED: true, QUERY_AUTO_TRANSFER_SCHEDULER: true, QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES: 0 };
    expect(autoTransferSettings(config).enabled).toBe(false);
    expect(startAutoTransferScheduler({ config })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('QUERY_AUTO_TRANSFER_TIMEOUT_MINUTES'));
    warn.mockRestore();
  });
});
