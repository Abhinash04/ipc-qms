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
import { AuditEvent } from '../models/AuditEvent.js';
import { ROLES } from '../constants/roles.js';
import { authHeader } from './helpers/auth.js';
import PASSWORDS from './fixtures/passwords.json' with { type: 'json' };

const ADMIN = authHeader(ROLES.ADMIN);
const SUPER_ADMIN = authHeader(ROLES.SUPER_ADMIN);
const PASSWORD = 'SecurePassword123';

let serial = 0;
async function signUp(overrides = {}) {
  serial += 1;
  const body = {
    name: `Applicant ${serial}`,
    email: `applicant${serial}@ipc.example`,
    department: 'Quality Assurance & Standards',
    designation: 'Reviewer',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  const { userId } = await User.findOne({ email: body.email.toLowerCase() }).lean();
  return { ...body, userId };
}

const login = (email, password = PASSWORD) => request(app).post('/api/v1/auth/login').send({ email, password });
const act = (who, userId, action, body = {}) =>
  request(app).post(`/api/v1/admin/users/${userId}/${action}`).set(who).send(body);
const list = (who = ADMIN) => request(app).get('/api/v1/admin/users').set(who);
const sessionOf = (res) => ({
  Cookie: res.headers['set-cookie'].find((entry) => entry.startsWith(`${authConfig.COOKIE_NAME}=`)).split(';')[0],
});
const auditOf = (action, userId) =>
  AuditEvent.find({ action }).lean().then((rows) => rows.filter((row) => row.details?.targetUserId === userId));

beforeEach(() => {
  db.connected = true;
});

describe('a signup request', () => {
  it('starts as Pending, is audited, and cannot sign in', async () => {
    const applicant = await signUp();

    expect((await User.findOne({ userId: applicant.userId }).lean()).status).toBe('PENDING');
    expect(await auditOf('USER_REGISTRATION_REQUESTED', applicant.userId)).toHaveLength(1);

    const res = await login(applicant.email);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Your account is awaiting approval by an administrator.');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('never takes its role from the requested designation', async () => {
    const applicant = await signUp({ designation: 'Super Admin' });
    const row = await User.findOne({ userId: applicant.userId }).lean();
    expect(row.role).toBeNull();
    expect(row.designation).toBe('Super Admin');
  });

  it('still refuses a duplicate email, whatever its case', async () => {
    const applicant = await signUp();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...applicant, email: applicant.email.toUpperCase() });
    expect(res.status).toBe(409);
  });
});

describe('the administrator list', () => {
  it('shows a pending request with its details and counts, and never a password', async () => {
    const applicant = await signUp({ designation: 'Front Officer' });

    const res = await list();
    expect(res.status).toBe(200);
    const account = res.body.accounts.find((entry) => entry.id === applicant.userId);
    expect(account).toMatchObject({
      name: applicant.name,
      email: applicant.email,
      requestedDesignation: 'Front Officer',
      department: applicant.department,
      role: null,
      status: 'PENDING',
      source: 'registered',
    });
    expect(account.createdAt).toEqual(expect.any(String));
    expect(res.body.counts.PENDING).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  it('lists the built-in accounts as approved and read-only', async () => {
    const res = await list();
    expect(res.body.accounts.find((entry) => entry.id === 'USR-0004')).toMatchObject({
      source: 'built-in',
      status: 'APPROVED',
      role: ROLES.ASSIGNED_OFFICIAL,
    });
  });

  it.each([ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER])(
    'is closed to the %s',
    async (role) => {
      expect((await list(authHeader(role))).status).toBe(403);
    },
  );
});

describe('approving', () => {
  it('requires a valid system role', async () => {
    const applicant = await signUp();

    expect((await act(ADMIN, applicant.userId, 'approve', {})).status).toBe(400);
    const unknown = await act(ADMIN, applicant.userId, 'approve', { role: 'Inquirer' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/system roles/i);
    expect((await User.findOne({ userId: applicant.userId }).lean()).status).toBe('PENDING');
  });

  it('assigns the chosen role, lets the user sign in with it, and audits who did what', async () => {
    const applicant = await signUp({ designation: 'Front Officer' });

    const res = await act(ADMIN, applicant.userId, 'approve', { role: ROLES.FRONT_OFFICE });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(
      'User approved successfully. The account is now active and can log in with the registered credentials.',
    );
    expect(res.body.account).toMatchObject({ status: 'APPROVED', role: ROLES.FRONT_OFFICE, reviewedBy: { id: 'USR-0007' } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);

    const signedIn = await login(applicant.email);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: applicant.userId, role: ROLES.FRONT_OFFICE });
    await vi.waitFor(async () => expect((await User.findOne({ userId: applicant.userId }).lean()).lastLoginAt).toEqual(expect.any(String)));

    const [assigned] = await auditOf('USER_ROLE_ASSIGNED', applicant.userId);
    const [approved] = await auditOf('USER_APPROVED', applicant.userId);
    expect(assigned).toMatchObject({ actorId: 'USR-0007', actorRole: ROLES.ADMIN, details: { role: ROLES.FRONT_OFFICE } });
    expect(approved).toMatchObject({ actorId: 'USR-0007', result: 'success', details: { targetEmail: applicant.email } });
  });

  it('cannot be applied twice', async () => {
    const applicant = await signUp();
    expect((await act(ADMIN, applicant.userId, 'approve', { role: ROLES.REVIEWER })).status).toBe(200);
    expect((await act(ADMIN, applicant.userId, 'approve', { role: ROLES.REVIEWER })).status).toBe(409);
  });

  it('lets only a Super Admin grant an administrator role', async () => {
    const applicant = await signUp({ designation: 'Admin' });

    for (const role of [ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
      const res = await act(ADMIN, applicant.userId, 'approve', { role });
      expect(res.status).toBe(403);
    }
    expect((await act(SUPER_ADMIN, applicant.userId, 'approve', { role: ROLES.ADMIN })).status).toBe(200);
  });

  it('is refused to every non-administrator, including an unauthenticated caller', async () => {
    const applicant = await signUp();
    for (const role of [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]) {
      expect((await act(authHeader(role), applicant.userId, 'approve', { role: ROLES.REVIEWER })).status).toBe(403);
    }
    expect((await request(app).post(`/api/v1/admin/users/${applicant.userId}/approve`).send({ role: ROLES.REVIEWER })).status).toBe(401);
    expect((await User.findOne({ userId: applicant.userId }).lean()).status).toBe('PENDING');
  });

  it('leaves built-in accounts alone', async () => {
    expect((await act(SUPER_ADMIN, 'USR-0004', 'deactivate')).status).toBe(409);
    expect((await act(SUPER_ADMIN, 'USR-0004', 'role', { role: ROLES.REVIEWER })).status).toBe(409);
  });

  it('answers 404 for an unknown account', async () => {
    expect((await act(ADMIN, 'USR-missing', 'approve', { role: ROLES.REVIEWER })).status).toBe(404);
  });
});

describe('rejecting', () => {
  it('stores the reason, audits it, and shows it to the person at sign-in', async () => {
    const applicant = await signUp();
    const reason = 'Your registration request could not be approved at this time.';

    const res = await act(ADMIN, applicant.userId, 'reject', { reason });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ status: 'REJECTED', role: null, rejectionReason: reason });

    const [rejected] = await auditOf('USER_REJECTED', applicant.userId);
    expect(rejected).toMatchObject({ actorId: 'USR-0007', details: { reason } });

    const signIn = await login(applicant.email);
    expect(signIn.status).toBe(403);
    expect(signIn.body.error).toBe(`Your registration request was not approved. ${reason}`);
  });

  it('works without a reason', async () => {
    const applicant = await signUp();
    expect((await act(ADMIN, applicant.userId, 'reject')).status).toBe(200);
    expect((await login(applicant.email)).body.error).toMatch(/not approved\. Please contact the IPC administration team/);
  });

  it('can still be reconsidered and approved later', async () => {
    const applicant = await signUp();
    await act(ADMIN, applicant.userId, 'reject');
    expect((await act(ADMIN, applicant.userId, 'approve', { role: ROLES.REVIEWER })).status).toBe(200);
    expect((await login(applicant.email)).status).toBe(200);
  });

  it('does not reveal the account state to a wrong password', async () => {
    const applicant = await signUp();
    await act(ADMIN, applicant.userId, 'reject', { reason: 'Secret note' });
    const res = await login(applicant.email, 'WrongPassword321');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret note|rejected/i);
  });
});

describe('deactivating', () => {
  async function approvedUser(role = ROLES.REVIEWER) {
    const applicant = await signUp();
    await act(SUPER_ADMIN, applicant.userId, 'approve', { role });
    return applicant;
  }

  it('blocks sign-in, ends the live session at once, and is undone by reactivating', async () => {
    const user = await approvedUser();
    const session = sessionOf(await login(user.email));
    expect((await request(app).get('/api/v1/auth/me').set(session)).status).toBe(200);

    expect((await act(ADMIN, user.userId, 'deactivate')).status).toBe(200);
    expect(await auditOf('USER_DEACTIVATED', user.userId)).toHaveLength(1);

    expect((await request(app).get('/api/v1/auth/me').set(session)).status).toBe(401);
    expect((await request(app).get('/api/v1/queries').set(session)).status).toBe(401);
    const blocked = await login(user.email);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/deactivated/i);

    expect((await act(ADMIN, user.userId, 'reactivate')).status).toBe(200);
    expect(await auditOf('USER_ACTIVATED', user.userId)).toHaveLength(1);
    expect((await request(app).get('/api/v1/auth/me').set(session)).status).toBe(200);
    expect((await login(user.email)).status).toBe(200);
  });

  it('applies a role change to the live session at once', async () => {
    const user = await approvedUser(ROLES.REVIEWER);
    const session = sessionOf(await login(user.email));

    expect((await act(ADMIN, user.userId, 'role', { role: ROLES.FRONT_OFFICE })).status).toBe(200);
    const me = await request(app).get('/api/v1/auth/me').set(session);
    expect(me.body.user.role).toBe(ROLES.FRONT_OFFICE);
  });

  it('keeps administrators of administrators to the Super Admin', async () => {
    const user = await approvedUser(ROLES.ADMIN);
    expect((await act(ADMIN, user.userId, 'deactivate')).status).toBe(403);
    expect((await act(ADMIN, user.userId, 'role', { role: ROLES.REVIEWER })).status).toBe(403);
    expect((await act(SUPER_ADMIN, user.userId, 'deactivate')).status).toBe(200);
  });

  it('refuses anyone acting on their own account', async () => {
    const admin = await approvedUser(ROLES.ADMIN);
    const own = sessionOf(await login(admin.email));
    const res = await act(own, admin.userId, 'deactivate');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own account/i);
  });
});

describe('existing accounts', () => {
  it('built-in accounts still sign in with their configured password while the database is connected', async () => {
    await User.create({ userId: 'USR-0005', name: 'Amit Mehta', email: 'amit.mehta@ipc.example', role: ROLES.REVIEWER, active: true });
    const res = await login('amit.mehta@ipc.example', PASSWORDS['USR-0005']);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'USR-0005', role: ROLES.REVIEWER });
  });

  it('a pre-review row with no status is treated by its role, without rewriting it', async () => {
    await User.create({ userId: 'USR-legacy1', name: 'Legacy', email: 'legacy@ipc.example', password: 'x', role: null, active: true });
    const res = await list();
    expect(res.body.accounts.find((entry) => entry.id === 'USR-legacy1').status).toBe('PENDING');
    expect((await User.findOne({ userId: 'USR-legacy1' }).lean()).status).toBeUndefined();
  });

  it('refuses user management while the database is offline', async () => {
    db.connected = false;
    expect((await list()).status).toBe(503);
  });
});
