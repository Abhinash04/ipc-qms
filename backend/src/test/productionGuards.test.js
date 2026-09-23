import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as mailbox from '../services/email/mailbox/index.js';

const RECEIVE = '/api/v1/mailbox/receive';
const RESET = '/api/v1/mailbox';
const MESSAGE = { from: 'ravi@pharma.example', subject: 'Query', body: 'Body' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('development-only mailbox endpoints under NODE_ENV=production', () => {
  it('refuses to inject a message, and delivers nothing', async () => {
    const deliver = vi.spyOn(mailbox, 'deliver');
    vi.stubEnv('NODE_ENV', 'production');

    const res = await request(app).post(RECEIVE).set(authHeader(ROLES.SUPER_ADMIN)).send(MESSAGE);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/refused when NODE_ENV=production/);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('refuses to wipe the mailbox, and resets nothing', async () => {
    const reset = vi.spyOn(mailbox, 'reset');
    vi.stubEnv('NODE_ENV', 'production');

    const res = await request(app).delete(RESET).set(authHeader(ROLES.SUPER_ADMIN));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/refused when NODE_ENV=production/);
    expect(reset).not.toHaveBeenCalled();
  });

  it('still answers 401 and 403 first — the guard is additive, not a replacement', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect((await request(app).post(RECEIVE).send(MESSAGE)).status).toBe(401);
    expect(
      (await request(app).post(RECEIVE).set(authHeader(ROLES.FRONT_OFFICE)).send(MESSAGE)).status,
    ).toBe(403);
    expect((await request(app).delete(RESET).set(authHeader(ROLES.ADMIN))).status).toBe(403);
  });
});

describe('the same endpoints outside production', () => {
  it('reaches the mailbox rather than the guard', async () => {
    const res = await request(app).post(RECEIVE).set(authHeader(ROLES.SUPER_ADMIN)).send(MESSAGE);

    expect(res.status).not.toBe(409);
  });
});
