import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const shared = { value: true };

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isSharedDatabase: () => shared.value,
}));

import app from '../app.js';
import { authHeader } from './helpers/auth.js';
import { ROLES } from '../constants/roles.js';
import * as mailbox from '../services/email/mailbox/index.js';

const RESET_QUERIES = '/api/v1/queries/reset';
const RESET_MAILBOX = '/api/v1/mailbox';

beforeEach(() => {
  shared.value = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('destructive endpoints on a shared database', () => {
  it('refuses to reset the workflow state', async () => {
    const res = await request(app).post(RESET_QUERIES).set(authHeader(ROLES.SUPER_ADMIN)).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'Resetting the workflow state is refused when DATABASE_URL points at a shared database.',
    );
  });

  it('refuses to wipe the mailbox, and resets nothing', async () => {
    const reset = vi.spyOn(mailbox, 'reset');

    const res = await request(app).delete(RESET_MAILBOX).set(authHeader(ROLES.SUPER_ADMIN));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Clearing the mailbox is refused when DATABASE_URL points at a shared database.');
    expect(reset).not.toHaveBeenCalled();
  });

  it('still answers 401 and 403 first', async () => {
    expect((await request(app).post(RESET_QUERIES).send({})).status).toBe(401);
    expect((await request(app).post(RESET_QUERIES).set(authHeader(ROLES.ADMIN)).send({})).status).toBe(403);
    expect((await request(app).delete(RESET_MAILBOX)).status).toBe(401);
    expect((await request(app).delete(RESET_MAILBOX).set(authHeader(ROLES.ADMIN))).status).toBe(403);
  });

  it('names production as the reason when both apply', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = await request(app).delete(RESET_MAILBOX).set(authHeader(ROLES.SUPER_ADMIN));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Clearing the mailbox is refused when NODE_ENV=production.');
  });
});

describe('the same endpoints on a local database', () => {
  beforeEach(() => {
    shared.value = false;
  });

  it('clears the mailbox', async () => {
    const res = await request(app).delete(RESET_MAILBOX).set(authHeader(ROLES.SUPER_ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
  });

  it('lets the reset through to the controller, which needs a connection', async () => {
    const res = await request(app).post(RESET_QUERIES).set(authHeader(ROLES.SUPER_ADMIN)).send({});

    expect(res.status).toBe(503);
  });
});
