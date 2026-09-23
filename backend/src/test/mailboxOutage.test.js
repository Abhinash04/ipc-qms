import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/**
 * What the Front Office sees when the mailbox cannot be reached.
 *
 * In a live test the machine's DNS resolver failed intermittently. Every poll
 * answered 500 — a server fault, for what was really an unavailable dependency —
 * and the page turned each one into a toast that never closed, so the Front
 * Officer collected a wall of identical errors for a single outage, and the
 * backend log collected one stack trace per poll.
 *
 * So: 503 while it is unreachable, 502 when the credential itself is refused,
 * and one log line and one audit row per *outage* rather than per poll.
 */

const store = vi.hoisted(() => ({ list: null }));

vi.mock('../services/email/mailbox/index.js', () => ({
  list: (...args) => store.list(...args),
  describe: () => ({ backend: 'nic', persistence: 'the NICeMail mailbox over IMAP, read-only' }),
  forUser: async () => null,
  supportsDelivery: () => false,
  get: async () => null,
  markIngested: async () => null,
  remove: async () => null,
  deliver: async () => null,
  reset: async () => {},
  stats: async () => ({ recipients: 0, messages: 0 }),
}));

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));

import { memoryDb } from './support/memoryDb.js';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as health from '../services/email/mailbox/health.js';

const poll = () =>
  request(app).get('/api/v1/mailbox/messages?unreadOnly=true').set(authHeader(ROLES.FRONT_OFFICE));

const auditRows = (action) => memoryDb.rows('AuditEvent').filter((row) => row.action === action);

const unreachable = () =>
  Object.assign(new Error('request to https://mail.mgovcloud.in/… failed, reason: getaddrinfo ENOTFOUND'), {
    code: 'ENOTFOUND',
  });

let warn;
let log;

beforeEach(() => {
  memoryDb.reset();
  health.reset();
  store.list = vi.fn(async () => []);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /mailbox/messages when the mailbox is unreachable', () => {
  it('answers 503 and says the poll keeps trying — not 500', async () => {
    store.list = vi.fn(async () => {
      throw unreachable();
    });

    const res = await poll();

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/could not be reached/i);
    expect(res.body.error).toMatch(/ENOTFOUND/);
    expect(res.body.retryable).toBe(true);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('answers 502 when the credential was refused, because retrying will not help', async () => {
    store.list = vi.fn(async () => {
      throw Object.assign(new Error('invalid_grant: Token has been expired or revoked.'), { status: 400 });
    });

    const res = await poll();

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/rejected the Front Office credential/i);
    expect(res.body.error).toMatch(/Re-authenticate the mailbox/);
    expect(res.body.retryable).toBe(false);
  });

  it('reports one outage once, however many polls fail', async () => {
    store.list = vi.fn(async () => {
      throw unreachable();
    });

    for (let i = 0; i < 5; i += 1) await poll();

    // One line in the log and one row in the trail — not five of each.
    expect(warn.mock.calls.filter(([line]) => String(line).includes('is unreachable'))).toHaveLength(1);
    expect(auditRows('SYNC_FAILED')).toHaveLength(1);
    expect(auditRows('SYNC_FAILED')[0].details).toMatchObject({ source: 'nic' });
  });

  it('records the recovery, with what the outage cost', async () => {
    store.list = vi.fn(async () => {
      throw unreachable();
    });
    await poll();
    await poll();

    store.list = vi.fn(async () => []);
    const res = await poll();

    expect(res.status).toBe(200);
    expect(res.body.sync).toMatchObject({ ok: true });
    expect(auditRows('SYNC_RECOVERED')).toHaveLength(1);
    expect(auditRows('SYNC_RECOVERED')[0].details).toMatchObject({ failures: 2, source: 'nic' });
    expect(log.mock.calls.some(([line]) => String(line).includes('reachable again'))).toBe(true);
  });

  it('carries the outage in the listing, so the page can show it without a toast', async () => {
    store.list = vi.fn(async () => {
      throw unreachable();
    });
    await poll();

    const res = await poll();

    expect(res.body.sync).toMatchObject({ ok: false, failures: 2 });
    expect(res.body.sync.error).toMatch(/ENOTFOUND/);
    expect(res.body.sync.since).toBeTruthy();
  });
});

describe('GET /health', () => {
  it('reports the mailbox and the AI service, so a quiet failure is visible', async () => {
    store.list = vi.fn(async () => {
      throw unreachable();
    });
    await poll();

    const res = await request(app).get('/api/v1/health').set(authHeader(ROLES.FRONT_OFFICE));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.mailbox).toMatchObject({ source: 'nic', ok: false });
    expect(res.body.ai).toMatchObject({ configured: expect.any(Boolean) });
    expect(res.body.database).toMatchObject({ connected: true });
  });
});
