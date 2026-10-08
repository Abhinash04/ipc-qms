import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const db = vi.hoisted(() => ({ connected: true }));

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => db.connected,
}));
vi.mock('../models/User.js', async () => ({
  User: (await import('./support/memoryDb.js')).memoryDb.model('User', { unique: ['userId', 'email'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));

import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import PASSWORDS from './fixtures/passwords.json' with { type: 'json' };

const register = (body) => request(app).post('/api/v1/auth/register').send(body);
const login = (email, password) => request(app).post('/api/v1/auth/login').send({ email, password });

let serial = 0;
const applicant = (overrides = {}) => {
  serial += 1;
  return {
    name: 'New Test User',
    email: `applicant${serial}@ipc.example`,
    department: 'Quality Assurance & Standards',
    designation: 'Reviewer',
    password: 'SecurePassword123',
    confirmPassword: 'SecurePassword123',
    ...overrides,
  };
};

beforeEach(() => {
  db.connected = true;
});

describe('POST /api/v1/auth/register', () => {
  it('stores the account with the requested designation, a bcrypt hash and no role', async () => {
    const body = applicant({ designation: 'Officer-in-Charge' });
    const res = await register(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, message: expect.stringMatching(/awaiting approval/i) });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|SecurePassword123/i);

    const stored = await User.findOne({ email: body.email }).lean();
    expect(stored).toMatchObject({ role: null, designation: 'Officer-in-Charge', department: body.department });
    expect(stored.userId).toMatch(/^USR-/);
    expect(stored.password).toMatch(/^\$2[aby]\$/);
    expect(stored.password).not.toBe(body.password);
  });

  it('never grants a role from the request, even Super Admin', async () => {
    const body = applicant({ designation: 'Super Admin', role: ROLES.SUPER_ADMIN });
    expect((await register(body)).status).toBe(201);
    expect((await User.findOne({ email: body.email }).lean()).role).toBeNull();
  });

  it('rejects an email already registered, whatever its case', async () => {
    const body = applicant();
    expect((await register(body)).status).toBe(201);

    const res = await register({ ...body, email: body.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, message: expect.stringMatching(/already exists/i) });
  });

  it('rejects the email of a built-in account', async () => {
    const res = await register(applicant({ email: 'Neha.Singh@ipc.example' }));
    expect(res.status).toBe(409);
  });

  it.each([
    ['a missing field', { department: '' }, /required/i],
    ['a non-string field', { name: { $gt: '' } }, /required/i],
    ['an invalid email', { email: 'not-an-email' }, /valid email/i],
    ['a short password', { password: 'short1', confirmPassword: 'short1' }, /at least 8/i],
    ['a password bcrypt would truncate', { password: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) }, /at most 72/i],
    ['passwords that differ', { confirmPassword: 'WrongPassword321' }, /must match/i],
  ])('rejects %s with 400', async (_label, overrides, message) => {
    const body = applicant(overrides);
    const res = await register(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: expect.stringMatching(message) });
    expect(await User.exists({ email: String(body.email).toLowerCase() })).toBeFalsy();
  });

  it('refuses with 503 while the database is offline, instead of keeping the account in memory', async () => {
    db.connected = false;
    const body = applicant();

    const res = await register(body);
    expect(res.status).toBe(503);
    db.connected = true;
    expect(await User.exists({ email: body.email })).toBeFalsy();
  });

  it('is served only under /api/v1, where the rate limits apply', async () => {
    expect((await request(app).post('/api/auth/register').send(applicant())).status).toBe(404);
    expect((await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'x' })).status).toBe(404);
  });
});

describe('signing in with a self-registered account', () => {
  it('is refused with 403 until an administrator approves it, and sets no session', async () => {
    const body = applicant();
    await register(body);

    const res = await login(body.email, body.password);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/awaiting approval/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('does not reveal that a pending account exists to someone with the wrong password', async () => {
    const body = applicant();
    await register(body);

    expect((await login(body.email, 'WrongPassword321')).status).toBe(401);
  });

  it('works once approved, with the role the administrator gave, and survives /auth/me', async () => {
    const body = applicant();
    await register(body);
    await User.updateOne({ email: body.email }, { $set: { role: ROLES.REVIEWER } });

    const res = await login(body.email.toUpperCase(), body.password);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: body.email, role: ROLES.REVIEWER });
    expect(res.body.user.id).toMatch(/^USR-/);
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);

    const cookie = res.headers['set-cookie'].find((entry) => entry.startsWith(`${authConfig.COOKIE_NAME}=`));
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: body.email, role: ROLES.REVIEWER });
  });

  it('is refused again when the administrator deactivates it', async () => {
    const body = applicant();
    await register(body);
    await User.updateOne({ email: body.email }, { $set: { role: ROLES.REVIEWER, active: false } });

    expect((await login(body.email, body.password)).status).toBe(403);
  });
});

describe('built-in accounts while the database is connected', () => {
  it('still sign in with their configured password when MongoDB holds their seeded row', async () => {
    // config/db.js seeds every built-in user into MongoDB, without a password.
    await User.create({
      userId: 'USR-0004',
      name: 'Neha Singh',
      email: 'neha.singh@ipc.example',
      role: ROLES.ASSIGNED_OFFICIAL,
      divisionId: 'DIV-005',
      active: true,
    });

    const res = await login('neha.singh@ipc.example', PASSWORDS['USR-0004']);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'USR-0004', role: ROLES.ASSIGNED_OFFICIAL });
  });
});
