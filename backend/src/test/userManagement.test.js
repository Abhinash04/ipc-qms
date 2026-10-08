import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

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
// The Recommendation Engine counts each official's open cases to break ties.
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));

import app from '../app.js';
import authConfig from '../config/authConfig.js';
import { User } from '../models/User.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { ROLES } from '../constants/roles.js';
import { USERS } from '../constants/users.js';
import { recommendOfficial } from '../services/ai/gemmaService.js';
import { assignableDirectory, recommendableOfficials } from '../services/ai/officialDirectory.js';
import { nextRecommendedOfficial } from '../services/query/autoTransferScheduler.js';
import { authHeader, AUTH } from './helpers/auth.js';
import { memoryDb } from './support/memoryDb.js';

const ADMIN = authHeader(ROLES.ADMIN);
const SUPER_ADMIN = authHeader(ROLES.SUPER_ADMIN);
const PASSWORD = 'SecurePassword123';

let serial = 0;
function newUser(overrides = {}) {
  serial += 1;
  return {
    name: `Managed User ${serial}`,
    email: `managed${serial}@ipc.example`,
    department: 'Quality Assurance',
    designation: 'Scientific Officer',
    role: ROLES.REVIEWER,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  };
}
const officer = (overrides = {}) =>
  newUser({ role: ROLES.ASSIGNED_OFFICIAL, divisionId: 'DIV-008', expertise: ['Nitrosamine', 'nitrosamine', ' NDMA '], ...overrides });

const create = (who, body) => request(app).post('/api/v1/admin/users').set(who).send(body);
const patch = (who, userId, body) => request(app).patch(`/api/v1/admin/users/${userId}`).set(who).send(body);
const resetPassword = (who, userId, password, confirmPassword = password) =>
  request(app).post(`/api/v1/admin/users/${userId}/password`).set(who).send({ password, confirmPassword });
const act = (who, userId, action, body = {}) =>
  request(app).post(`/api/v1/admin/users/${userId}/${action}`).set(who).send(body);
const login = (email, password = PASSWORD) => request(app).post('/api/v1/auth/login').send({ email, password });
const me = (session) => request(app).get('/api/v1/auth/me').set(session);
const sessionOf = (res) => ({
  Cookie: res.headers['set-cookie'].find((entry) => entry.startsWith(`${authConfig.COOKIE_NAME}=`)).split(';')[0],
});
const rowOf = (userId) => User.findOne({ userId }).lean();
const auditOf = (action, userId) =>
  AuditEvent.find({ action }).lean().then((rows) => rows.filter((row) => row.details?.targetUserId === userId));

async function created(who, body) {
  const res = await create(who, body);
  expect(res.status).toBe(201);
  return res.body.account;
}

beforeEach(() => {
  db.connected = true;
});

describe('who may manage users', () => {
  const routes = [
    ['create', (who) => create(who, newUser())],
    ['edit', (who) => patch(who, 'USR-x', { name: 'X' })],
    ['reset a password', (who) => resetPassword(who, 'USR-x', PASSWORD)],
  ];

  it.each(routes)('refuses to %s without a session', async (_label, call) => {
    expect((await call({})).status).toBe(401);
  });

  it.each(routes)('refuses every non-administrator to %s', async (_label, call) => {
    for (const role of [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]) {
      expect((await call(authHeader(role))).status).toBe(403);
    }
  });

  it('lets both an Admin and a Super Admin add a user', async () => {
    expect((await create(ADMIN, newUser())).status).toBe(201);
    expect((await create(SUPER_ADMIN, newUser())).status).toBe(201);
  });
});

describe('adding a user', () => {
  it('stores an approved account with its role, a bcrypt hash, and never returns the password', async () => {
    const body = newUser({ role: ROLES.FRONT_OFFICE, email: `  Mixed.Case${serial}@IPC.example ` });
    const res = await create(ADMIN, body);

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ role: ROLES.FRONT_OFFICE, status: 'APPROVED', source: 'registered' });
    expect(JSON.stringify(res.body)).not.toMatch(/"password"|\$2[aby]\$/i);

    const row = await rowOf(res.body.account.id);
    expect(row).toMatchObject({
      email: body.email.trim().toLowerCase(),
      role: ROLES.FRONT_OFFICE,
      status: 'APPROVED',
      active: true,
      reviewedBy: { id: 'USR-0007' },
    });
    expect(await bcrypt.compare(PASSWORD, row.password)).toBe(true);
    expect(await auditOf('USER_CREATED', row.userId)).toHaveLength(1);
    expect(JSON.stringify(await auditOf('USER_CREATED', row.userId))).not.toContain(PASSWORD);
  });

  it('can sign in at once with the password the administrator set', async () => {
    const body = newUser();
    await created(ADMIN, body);
    const res = await login(body.email);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(ROLES.REVIEWER);
  });

  it('stores an Assigned Official with its division and its expertise, lowercased and without repeats', async () => {
    const account = await created(ADMIN, officer());
    expect(account).toMatchObject({ divisionId: 'DIV-008', expertise: ['nitrosamine', 'ndma'] });
    expect((await rowOf(account.id)).expertise).toEqual(['nitrosamine', 'ndma']);
  });

  it.each([
    ['without expertise', { expertise: [] }, /expertise/i],
    ['without a division', { divisionId: null }, /division/i],
    ['with an unknown division', { divisionId: 'DIV-999' }, /division/i],
  ])('refuses an Assigned Official %s', async (_label, overrides, message) => {
    const res = await create(ADMIN, officer(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it.each([
    ['a short password', { password: 'short', confirmPassword: 'short' }, /at least 8/],
    ['a password over 72 bytes', { password: 'é'.repeat(40), confirmPassword: 'é'.repeat(40) }, /72 bytes/],
    ['a mismatched confirmation', { confirmPassword: 'Different123' }, /must match/],
    ['an unknown role', { role: 'INQUIRER' }, /system roles/],
  ])('refuses %s', async (_label, overrides, message) => {
    const res = await create(ADMIN, newUser(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('refuses fields an administrator may not set, such as the status', async () => {
    expect((await create(ADMIN, newUser({ status: 'APPROVED' }))).status).toBe(400);
    expect((await create(ADMIN, newUser({ email: 'not-an-email' }))).status).toBe(400);
  });

  it('refuses an email already in use, by a registered or a built-in account', async () => {
    const body = newUser();
    await created(ADMIN, body);
    expect((await create(ADMIN, newUser({ email: body.email.toUpperCase() }))).status).toBe(409);
    expect((await create(ADMIN, newUser({ email: 'neha.singh@ipc.example' }))).status).toBe(409);
  });

  it('refuses while the database is offline', async () => {
    db.connected = false;
    expect((await create(ADMIN, newUser())).status).toBe(503);
  });
});

describe('privileged roles', () => {
  it('lets only a Super Admin create an administrator', async () => {
    for (const role of [ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
      const res = await create(ADMIN, newUser({ role }));
      expect(res.status).toBe(403);
    }
    expect((await created(SUPER_ADMIN, newUser({ role: ROLES.ADMIN }))).role).toBe(ROLES.ADMIN);
  });

  it('lets an Admin neither promote anyone to administrator nor touch an administrator account', async () => {
    const reviewer = await created(ADMIN, newUser());
    expect((await patch(ADMIN, reviewer.id, { role: ROLES.ADMIN })).status).toBe(403);
    expect((await patch(ADMIN, reviewer.id, { role: ROLES.SUPER_ADMIN })).status).toBe(403);
    expect((await rowOf(reviewer.id)).role).toBe(ROLES.REVIEWER);

    const admin = await created(SUPER_ADMIN, newUser({ role: ROLES.ADMIN }));
    expect((await patch(ADMIN, admin.id, { name: 'Renamed' })).status).toBe(403);
    expect((await patch(ADMIN, admin.id, { role: ROLES.REVIEWER })).status).toBe(403);
    expect((await patch(ADMIN, admin.id, { active: false })).status).toBe(403);
    expect((await resetPassword(ADMIN, admin.id, 'NewPassword456')).status).toBe(403);
    expect(await rowOf(admin.id)).toMatchObject({ name: admin.name, role: ROLES.ADMIN, status: 'APPROVED' });

    expect((await patch(SUPER_ADMIN, admin.id, { name: 'Renamed' })).status).toBe(200);
  });

  it('refuses an administrator changing their own account, however they ask', async () => {
    const body = newUser({ role: ROLES.ADMIN });
    const admin = await created(SUPER_ADMIN, body);
    const own = sessionOf(await login(body.email));

    expect((await patch(own, admin.id, { role: ROLES.SUPER_ADMIN })).status).toBe(403);
    expect((await patch(own, admin.id, { name: 'Me' })).status).toBe(403);
    expect((await resetPassword(own, admin.id, 'NewPassword456')).status).toBe(403);
    expect((await create(own, newUser({ role: ROLES.SUPER_ADMIN }))).status).toBe(403);
    expect((await rowOf(admin.id)).role).toBe(ROLES.ADMIN);
  });

  it('leaves built-in accounts to configuration', async () => {
    expect((await patch(SUPER_ADMIN, 'USR-0004', { expertise: ['x'] })).status).toBe(409);
    expect((await resetPassword(SUPER_ADMIN, 'USR-0004', 'NewPassword456')).status).toBe(409);
  });
});

describe('editing a user', () => {
  it('saves the details it is sent and audits which fields changed', async () => {
    const account = await created(ADMIN, newUser());
    const res = await patch(ADMIN, account.id, {
      name: 'Edited Name',
      email: `edited${serial}@ipc.example`,
      designation: 'Senior Scientific Officer',
      department: 'Analytical',
    });

    expect(res.status).toBe(200);
    expect(await rowOf(account.id)).toMatchObject({
      name: 'Edited Name',
      email: `edited${serial}@ipc.example`,
      designation: 'Senior Scientific Officer',
      department: 'Analytical',
    });
    const [updated] = await auditOf('USER_UPDATED', account.id);
    expect(updated.details.changed).toEqual(['name', 'department', 'designation', 'email']);
  });

  it('never changes the password or the review fields', async () => {
    const account = await created(ADMIN, newUser());
    expect((await patch(ADMIN, account.id, { password: 'Hijack12345' })).status).toBe(400);
    expect((await patch(ADMIN, account.id, { status: 'APPROVED' })).status).toBe(400);
    expect((await patch(ADMIN, account.id, {})).status).toBe(400);
  });

  it('refuses an email that belongs to someone else', async () => {
    const first = newUser();
    await created(ADMIN, first);
    const second = await created(ADMIN, newUser());
    expect((await patch(ADMIN, second.id, { email: first.email })).status).toBe(409);
    expect((await patch(ADMIN, second.id, { email: 'amit.mehta@ipc.example' })).status).toBe(409);
  });

  it('changes the role, which the live session picks up at once', async () => {
    const body = newUser();
    const account = await created(ADMIN, body);
    const session = sessionOf(await login(body.email));

    expect((await patch(ADMIN, account.id, { role: ROLES.FRONT_OFFICE })).status).toBe(200);
    expect((await rowOf(account.id)).role).toBe(ROLES.FRONT_OFFICE);
    expect((await me(session)).body.user.role).toBe(ROLES.FRONT_OFFICE);
    expect(await auditOf('USER_ROLE_ASSIGNED', account.id)).toHaveLength(2);
  });

  it('needs expertise and a division to make someone an Assigned Official', async () => {
    const account = await created(ADMIN, newUser());
    expect((await patch(ADMIN, account.id, { role: ROLES.ASSIGNED_OFFICIAL })).status).toBe(400);
    const res = await patch(ADMIN, account.id, { role: ROLES.ASSIGNED_OFFICIAL, divisionId: 'DIV-005', expertise: ['assay'] });
    expect(res.status).toBe(200);
    expect(await rowOf(account.id)).toMatchObject({ role: ROLES.ASSIGNED_OFFICIAL, divisionId: 'DIV-005', expertise: ['assay'] });
  });

  it('deactivates and reactivates through the active switch', async () => {
    const body = newUser();
    const account = await created(ADMIN, body);
    const session = sessionOf(await login(body.email));

    expect((await patch(ADMIN, account.id, { active: false })).body.account.status).toBe('DEACTIVATED');
    expect(await rowOf(account.id)).toMatchObject({ status: 'DEACTIVATED', active: false });
    expect((await me(session)).status).toBe(401);
    expect((await login(body.email)).status).toBe(403);
    expect(await auditOf('USER_DEACTIVATED', account.id)).toHaveLength(1);

    expect((await patch(ADMIN, account.id, { active: true })).body.account.status).toBe('APPROVED');
    expect((await login(body.email)).status).toBe(200);
  });

  it('keeps a pending request from being given a role or switched on outside approval', async () => {
    const signUp = newUser();
    await request(app).post('/api/v1/auth/register').send(signUp);
    const { userId } = await User.findOne({ email: signUp.email }).lean();

    expect((await patch(ADMIN, userId, { role: ROLES.REVIEWER })).status).toBe(409);
    expect((await patch(ADMIN, userId, { active: true })).status).toBe(409);
    expect((await patch(ADMIN, userId, { designation: 'Fixed typo' })).status).toBe(200);
    expect(await rowOf(userId)).toMatchObject({ status: 'PENDING', role: null, designation: 'Fixed typo' });
  });

  it('asks for expertise when a request is approved as an Assigned Official, and stores it', async () => {
    const signUp = newUser();
    await request(app).post('/api/v1/auth/register').send(signUp);
    const { userId } = await User.findOne({ email: signUp.email }).lean();

    expect((await act(ADMIN, userId, 'approve', { role: ROLES.ASSIGNED_OFFICIAL })).status).toBe(400);
    const res = await act(ADMIN, userId, 'approve', {
      role: ROLES.ASSIGNED_OFFICIAL,
      divisionId: 'DIV-007',
      expertise: ['Sterility'],
    });
    expect(res.status).toBe(200);
    expect(await rowOf(userId)).toMatchObject({ status: 'APPROVED', divisionId: 'DIV-007', expertise: ['sterility'] });
  });
});

describe('resetting a password', () => {
  afterEach(() => vi.useRealTimers());

  it('replaces the password, ends older sessions, and never records the password', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    const body = newUser();
    const account = await created(ADMIN, body);
    const oldSession = sessionOf(await login(body.email));
    expect((await me(oldSession)).status).toBe(200);

    vi.setSystemTime(new Date('2026-10-01T10:00:05Z'));
    expect((await resetPassword(ADMIN, account.id, 'BrandNewPass99', 'Mismatch')).status).toBe(400);
    const res = await resetPassword(ADMIN, account.id, 'BrandNewPass99');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/"password"|\$2[aby]\$/i);

    expect((await me(oldSession)).status).toBe(401);
    expect((await login(body.email)).status).toBe(401);
    const fresh = await login(body.email, 'BrandNewPass99');
    expect(fresh.status).toBe(200);
    expect((await me(sessionOf(fresh))).status).toBe(200);

    const audits = await auditOf('USER_PASSWORD_RESET', account.id);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('BrandNewPass99');
  });

  it('applies the same password rules as sign-up', async () => {
    const account = await created(ADMIN, newUser());
    expect((await resetPassword(ADMIN, account.id, 'short')).status).toBe(400);
  });
});

describe('the Recommendation Engine', () => {
  // Officers added by earlier tests would compete for the same keywords.
  beforeEach(() => memoryDb.reset());

  const nitrosamineQuery = {
    subject: 'Nitrosamine limits in sartans',
    body: 'Please clarify the acceptable nitrosamine intake for valsartan tablets.',
    summaryText: 'Question on nitrosamine limits.',
  };

  it('recommends an officer an administrator added, by their expertise', async () => {
    const account = await created(ADMIN, officer({ expertise: ['nitrosamine'] }));

    const [top] = await recommendOfficial(nitrosamineQuery);
    expect(top).toMatchObject({ userId: account.id, name: account.name, divisionId: 'DIV-008', matchedKeywords: ['nitrosamine'] });

    const res = await request(app).post('/api/v1/ai/recommend').set(AUTH).send(nitrosamineQuery);
    expect(res.body.recommendations[0].userId).toBe(account.id);
  });

  it('follows an expertise change on the next recommendation', async () => {
    const account = await created(ADMIN, officer({ expertise: ['nitrosamine'] }));
    await patch(ADMIN, account.id, { expertise: ['elemental impurities'] });

    const ids = (await recommendOfficial(nitrosamineQuery)).filter((rec) => rec.matchedKeywords.length).map((rec) => rec.userId);
    expect(ids).not.toContain(account.id);
    const [top] = await recommendOfficial({ subject: 'Elemental impurities in tablets' });
    expect(top.userId).toBe(account.id);
  });

  it('never recommends or auto-transfers to a deactivated officer', async () => {
    const account = await created(ADMIN, officer({ expertise: ['nitrosamine'] }));
    expect((await assignableDirectory()).map((user) => user.id)).toContain(account.id);

    await act(ADMIN, account.id, 'deactivate');

    expect((await recommendableOfficials()).map((o) => o.userId)).not.toContain(account.id);
    expect((await recommendOfficial(nitrosamineQuery)).map((rec) => rec.userId)).not.toContain(account.id);
    const directory = await assignableDirectory();
    expect(directory.map((user) => user.id)).not.toContain(account.id);
    const next = nextRecommendedOfficial({ ranking: [{ userId: account.id }, { userId: 'USR-0004' }], directory });
    expect(next.user.id).toBe('USR-0004');
  });

  it('ignores officers that are not approved', async () => {
    await User.create({
      userId: 'USR-pending1',
      name: 'Pending Officer',
      email: 'pending.officer@ipc.example',
      password: 'x',
      role: ROLES.ASSIGNED_OFFICIAL,
      status: 'PENDING',
      expertise: ['nitrosamine'],
      divisionId: 'DIV-008',
    });
    expect((await recommendableOfficials()).map((o) => o.userId)).not.toContain('USR-pending1');
  });

  it('still works from the built-in officials while the database is offline', async () => {
    db.connected = false;
    const [top] = await recommendOfficial({ subject: 'dissolution and assay' });
    expect(top.userId).toBe('USR-0004');
  });
});

describe('existing accounts', () => {
  it('lists every built-in account, with the expertise configured for built-in officials', async () => {
    const res = await request(app).get('/api/v1/admin/users').set(ADMIN);
    const ids = res.body.accounts.map((account) => account.id);
    for (const user of USERS) expect(ids).toContain(user.id);
    expect(res.body.accounts.find((account) => account.id === 'USR-0004')).toMatchObject({
      divisionId: 'DIV-005',
      expertise: expect.arrayContaining(['assay', 'dissolution']),
      source: 'built-in',
    });
  });
});
