import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import HTTP_STATUS from '../../constants/httpStatus.js';
import { ROLES, ACCOUNT_STATUS, ADMIN_ROLES, ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_ACTIONS } from '../../constants/auditActions.js';
import { allUsers } from '../../constants/users.js';
import { isConnected } from '../../config/db.js';
import { IPC_DIVISIONS, ASSIGNED_OFFICIALS } from '../../config/officialsMetadata.js';
import { User } from '../../models/User.js';
import * as audit from '../audit/auditService.js';
import { PUBLIC_ACCOUNT_FIELDS, SELF_REGISTERED, isBuiltIn, statusOf, findByEmail } from './userDirectory.js';
import { BCRYPT_ROUNDS } from './credentials.js';
import { passwordProblem } from './passwordPolicy.js';

const VALID_ROLES = new Set(Object.values(ROLES));
const DIVISION_IDS = new Set(IPC_DIVISIONS.map((division) => division.id));
const BUILT_IN_EXPERTISE = new Map(ASSIGNED_OFFICIALS.map((official) => [official.userId, official.expertise]));
const MAX_REASON = 500;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** A self-registered row as an administrator sees it: never the password hash. */
function toAccount(row) {
  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    department: row.department || '',
    requestedDesignation: row.designation || '',
    role: row.role ?? null,
    divisionId: row.divisionId ?? null,
    expertise: row.expertise ?? [],
    status: statusOf(row),
    source: 'registered',
    createdAt: row.createdAt ?? null,
    reviewedBy: row.reviewedBy?.id ? row.reviewedBy : null,
    reviewedAt: row.reviewedAt ?? null,
    rejectionReason: row.rejectionReason ?? null,
    deactivatedAt: row.deactivatedAt ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

/** A built-in account: approved by configuration, and not changeable here. */
function toBuiltInAccount(user, seeded) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: '',
    requestedDesignation: '',
    role: user.role,
    divisionId: user.divisionId ?? null,
    expertise: BUILT_IN_EXPERTISE.get(user.id) ?? [],
    status: ACCOUNT_STATUS.APPROVED,
    source: 'built-in',
    createdAt: seeded?.createdAt ?? null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    deactivatedAt: null,
    lastLoginAt: seeded?.lastLoginAt ?? null,
  };
}

function requireDatabase() {
  if (!isConnected()) throw fail(HTTP_STATUS.SERVICE_UNAVAILABLE, 'User management needs the database, which is offline');
}

/** Every account, built-in and self-registered, with how many are in each status. */
export async function listAccounts() {
  requireDatabase();
  const builtIn = allUsers();
  const [registered, seeded] = await Promise.all([
    User.find(SELF_REGISTERED).select(PUBLIC_ACCOUNT_FIELDS).lean(),
    User.find({ userId: { $in: builtIn.map((user) => user.id) } }).select('userId createdAt lastLoginAt').lean(),
  ]);
  const seededById = new Map(seeded.map((row) => [row.userId, row]));

  const accounts = [
    ...registered.map(toAccount),
    ...builtIn.map((user) => toBuiltInAccount(user, seededById.get(user.id))),
  ];
  const counts = Object.fromEntries(Object.values(ACCOUNT_STATUS).map((status) => [status, 0]));
  for (const account of accounts) counts[account.status] += 1;

  return { accounts, counts };
}

/** The rules every administrative change obeys, whatever the client sends. */
function assertMayChange(actor, userId) {
  if (!actor?.id) throw fail(HTTP_STATUS.UNAUTHORIZED, 'Authentication required');
  if (actor.id === userId) throw fail(HTTP_STATUS.FORBIDDEN, 'You cannot change your own account');
  if (isBuiltIn(userId)) {
    throw fail(HTTP_STATUS.CONFLICT, 'Built-in accounts are managed by configuration and cannot be changed here');
  }
}

function assertMayGrant(actor, role) {
  if (!VALID_ROLES.has(role)) throw fail(HTTP_STATUS.BAD_REQUEST, 'Choose one of the system roles');
  if (ADMIN_ROLES.includes(role) && actor.role !== ROLES.SUPER_ADMIN) {
    throw fail(HTTP_STATUS.FORBIDDEN, 'Only a Super Admin can grant an administrator role');
  }
}

/** Changing an account that holds an administrator role takes a Super Admin. */
function assertMayManage(actor, row) {
  if (ADMIN_ROLES.includes(row.role) && actor.role !== ROLES.SUPER_ADMIN) {
    throw fail(HTTP_STATUS.FORBIDDEN, 'Only a Super Admin can change an administrator account');
  }
}

/**
 * The Recommendation Engine finds Assigned Officials by their expertise and division, so an
 * account in that role must have both. Any division given must be a real one, whatever the role.
 */
function assertOfficerFields(role, expertise, divisionId) {
  if (divisionId && !DIVISION_IDS.has(divisionId)) throw fail(HTTP_STATUS.BAD_REQUEST, 'Choose one of the IPC divisions');
  if (role !== ROLES.ASSIGNED_OFFICIAL) return;
  if (!divisionId) throw fail(HTTP_STATUS.BAD_REQUEST, 'An Assigned Official needs a division');
  if (!expertise?.length) {
    throw fail(HTTP_STATUS.BAD_REQUEST, 'An Assigned Official needs at least one area of expertise');
  }
}

/** Officer fields to store: only those the request actually carries. */
function officerUpdate(expertise, divisionId) {
  return {
    ...(expertise !== undefined && { expertise }),
    ...(divisionId !== undefined && { divisionId: divisionId || null }),
  };
}

const emailTaken = () => fail(HTTP_STATUS.CONFLICT, 'An account with this email already exists');

async function assertEmailFree(email, exceptUserId = null) {
  if (findByEmail(email)) throw emailTaken();
  const row = await User.findOne({ email }).select('userId').lean();
  if (row && row.userId !== exceptUserId) throw emailTaken();
}

function assertNewPassword(password, confirmPassword) {
  const problem = passwordProblem(password);
  if (problem) throw fail(HTTP_STATUS.BAD_REQUEST, problem);
  if (password !== confirmPassword) throw fail(HTTP_STATUS.BAD_REQUEST, 'Password and confirm password must match');
}

async function loadAccount(userId) {
  const row = await User.findOne({ userId, ...SELF_REGISTERED }).select(PUBLIC_ACCOUNT_FIELDS).lean();
  if (!row) throw fail(HTTP_STATUS.NOT_FOUND, 'No registration request with that ID');
  return row;
}

/**
 * Applies `update` only while the account is still in one of `from`: a second click, or two
 * administrators deciding at once, cannot apply a change twice or undo another's decision.
 */
async function transition(row, from, update, verb) {
  const current = statusOf(row);
  if (!from.includes(current)) {
    throw fail(HTTP_STATUS.CONFLICT, `This account is ${current.toLowerCase()} and cannot be ${verb}`);
  }
  const guard = row.status ? { status: row.status } : { status: { $exists: false }, role: row.role ?? null };
  const { modifiedCount } = await User.updateOne({ userId: row.userId, ...SELF_REGISTERED, ...guard }, { $set: update });
  if (!modifiedCount) throw fail(HTTP_STATUS.CONFLICT, 'Someone else changed this account first. Refresh and try again.');
  return toAccount(await loadAccount(row.userId));
}

const reviewer = (actor) => ({ id: actor.id, name: actor.name || actor.id, role: actor.role });

async function record(action, actor, row, extra = {}) {
  await audit.record({
    action,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: actor.id,
    actorRole: actor.role,
    details: {
      targetUserId: row.userId,
      targetName: row.name,
      targetEmail: row.email,
      requestedDesignation: row.designation || null,
      ...extra,
    },
  });
}

export async function approve(actor, userId, role, { expertise, divisionId } = {}) {
  requireDatabase();
  assertMayChange(actor, userId);
  assertMayGrant(actor, role);
  const row = await loadAccount(userId);
  assertOfficerFields(role, expertise ?? row.expertise, divisionId !== undefined ? divisionId : row.divisionId);
  const now = new Date().toISOString();

  const account = await transition(
    row,
    [ACCOUNT_STATUS.PENDING, ACCOUNT_STATUS.REJECTED],
    {
      status: ACCOUNT_STATUS.APPROVED,
      role,
      active: true,
      reviewedBy: reviewer(actor),
      reviewedAt: now,
      rejectionReason: null,
      ...officerUpdate(expertise, divisionId),
    },
    'approved',
  );

  await record(AUDIT_ACTIONS.USER_ROLE_ASSIGNED, actor, row, { role, previousRole: row.role ?? null });
  await record(AUDIT_ACTIONS.USER_APPROVED, actor, row, { role, previousStatus: statusOf(row) });
  return account;
}

export async function reject(actor, userId, reason = '') {
  requireDatabase();
  assertMayChange(actor, userId);
  const text = String(reason || '').trim().slice(0, MAX_REASON);
  const row = await loadAccount(userId);

  const account = await transition(
    row,
    [ACCOUNT_STATUS.PENDING],
    { status: ACCOUNT_STATUS.REJECTED, role: null, reviewedBy: reviewer(actor), reviewedAt: new Date().toISOString(), rejectionReason: text || null },
    'rejected',
  );

  await record(AUDIT_ACTIONS.USER_REJECTED, actor, row, { reason: text || null });
  return account;
}

export async function deactivate(actor, userId) {
  requireDatabase();
  assertMayChange(actor, userId);
  const row = await loadAccount(userId);
  if (ADMIN_ROLES.includes(row.role) && actor.role !== ROLES.SUPER_ADMIN) {
    throw fail(HTTP_STATUS.FORBIDDEN, 'Only a Super Admin can deactivate an administrator');
  }

  const account = await transition(
    row,
    [ACCOUNT_STATUS.APPROVED],
    { status: ACCOUNT_STATUS.DEACTIVATED, active: false, deactivatedAt: new Date().toISOString() },
    'deactivated',
  );

  await record(AUDIT_ACTIONS.USER_DEACTIVATED, actor, row, { role: row.role ?? null });
  return account;
}

export async function reactivate(actor, userId) {
  requireDatabase();
  assertMayChange(actor, userId);
  const row = await loadAccount(userId);
  // Reactivating restores the role it had; restoring an administrator role takes a Super Admin.
  if (row.role) assertMayGrant(actor, row.role);

  const account = await transition(
    row,
    [ACCOUNT_STATUS.DEACTIVATED],
    { status: ACCOUNT_STATUS.APPROVED, active: true, deactivatedAt: null },
    'reactivated',
  );

  await record(AUDIT_ACTIONS.USER_ACTIVATED, actor, row, { role: row.role ?? null });
  return account;
}

export async function changeRole(actor, userId, role, { expertise, divisionId } = {}) {
  requireDatabase();
  assertMayChange(actor, userId);
  assertMayGrant(actor, role);
  const row = await loadAccount(userId);
  // Taking an administrator role away is as privileged as giving one.
  if (ADMIN_ROLES.includes(row.role) && actor.role !== ROLES.SUPER_ADMIN) {
    throw fail(HTTP_STATUS.FORBIDDEN, 'Only a Super Admin can change an administrator\'s role');
  }
  if (row.role === role) throw fail(HTTP_STATUS.CONFLICT, 'The account already has that role');
  assertOfficerFields(role, expertise ?? row.expertise, divisionId !== undefined ? divisionId : row.divisionId);

  const account = await transition(
    row,
    [ACCOUNT_STATUS.APPROVED],
    { role, ...officerUpdate(expertise, divisionId) },
    'given a new role',
  );

  await record(AUDIT_ACTIONS.USER_ROLE_ASSIGNED, actor, row, { role, previousRole: row.role ?? null });
  return account;
}

/**
 * An account an administrator creates directly: approved at once with the role they chose, and
 * signing in with the password they set. It is stored exactly like an approved self-registration.
 */
export async function create(actor, input) {
  requireDatabase();
  if (!actor?.id) throw fail(HTTP_STATUS.UNAUTHORIZED, 'Authentication required');
  assertMayGrant(actor, input.role);
  assertNewPassword(input.password, input.confirmPassword);
  const divisionId = input.divisionId || null;
  assertOfficerFields(input.role, input.expertise, divisionId);
  await assertEmailFree(input.email);

  const now = new Date().toISOString();
  const row = {
    userId: `USR-${randomUUID().slice(0, 8)}`,
    name: input.name,
    email: input.email,
    department: input.department || '',
    designation: input.designation || '',
    role: input.role,
    divisionId,
    ...(input.expertise?.length && { expertise: input.expertise }),
    active: true,
    status: ACCOUNT_STATUS.APPROVED,
    reviewedBy: reviewer(actor),
    reviewedAt: now,
    createdAt: now,
  };
  try {
    await User.create({ ...row, password: await bcrypt.hash(input.password, BCRYPT_ROUNDS) });
  } catch (error) {
    if (error?.code === 11000) throw emailTaken();
    throw error;
  }

  await record(AUDIT_ACTIONS.USER_CREATED, actor, row, { role: row.role, divisionId, expertise: row.expertise ?? [] });
  await record(AUDIT_ACTIONS.USER_ROLE_ASSIGNED, actor, row, { role: row.role, previousRole: null });
  return toAccount(await loadAccount(row.userId));
}

const sameList = (a = [], b = []) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Edits an account's details, and optionally its role and whether it is active, in one guarded
 * write. Each part obeys the same rules as its single-purpose action above.
 */
export async function update(actor, userId, patch) {
  requireDatabase();
  assertMayChange(actor, userId);
  const row = await loadAccount(userId);
  assertMayManage(actor, row);
  const current = statusOf(row);
  const set = {};
  const changed = [];

  for (const field of ['name', 'department', 'designation']) {
    if (patch[field] !== undefined && patch[field] !== (row[field] ?? '')) {
      set[field] = patch[field];
      changed.push(field);
    }
  }
  if (patch.email !== undefined && patch.email !== row.email) {
    await assertEmailFree(patch.email, userId);
    set.email = patch.email;
    changed.push('email');
  }
  if (patch.divisionId !== undefined && (patch.divisionId || null) !== (row.divisionId ?? null)) {
    set.divisionId = patch.divisionId || null;
    changed.push('division');
  }
  if (patch.expertise !== undefined && !sameList(patch.expertise, row.expertise ?? [])) {
    set.expertise = patch.expertise;
    changed.push('expertise');
  }

  const roleChanging = patch.role !== undefined && patch.role !== row.role;
  if (roleChanging) {
    if (![ACCOUNT_STATUS.APPROVED, ACCOUNT_STATUS.DEACTIVATED].includes(current)) {
      throw fail(HTTP_STATUS.CONFLICT, 'Approve this request to give it a role');
    }
    assertMayGrant(actor, patch.role);
    set.role = patch.role;
  }
  const role = set.role ?? row.role;

  let switched = null;
  if (patch.active !== undefined && patch.active !== (current === ACCOUNT_STATUS.APPROVED)) {
    if (![ACCOUNT_STATUS.APPROVED, ACCOUNT_STATUS.DEACTIVATED].includes(current)) {
      throw fail(HTTP_STATUS.CONFLICT, `This account is ${current.toLowerCase()} and cannot be switched on or off`);
    }
    if (patch.active) {
      if (role) assertMayGrant(actor, role);
      Object.assign(set, { status: ACCOUNT_STATUS.APPROVED, active: true, deactivatedAt: null });
      switched = AUDIT_ACTIONS.USER_ACTIVATED;
    } else {
      Object.assign(set, { status: ACCOUNT_STATUS.DEACTIVATED, active: false, deactivatedAt: new Date().toISOString() });
      switched = AUDIT_ACTIONS.USER_DEACTIVATED;
    }
  }

  if (roleChanging || 'expertise' in set || 'divisionId' in set) {
    assertOfficerFields(role, set.expertise ?? row.expertise, 'divisionId' in set ? set.divisionId : row.divisionId);
  }
  if (!Object.keys(set).length) return toAccount(row);

  let account;
  try {
    account = await transition(
      row,
      [ACCOUNT_STATUS.PENDING, ACCOUNT_STATUS.APPROVED, ACCOUNT_STATUS.DEACTIVATED],
      set,
      'changed',
    );
  } catch (error) {
    if (error?.code === 11000) throw emailTaken();
    throw error;
  }

  const target = { ...row, ...set };
  if (changed.length) {
    await record(AUDIT_ACTIONS.USER_UPDATED, actor, target, {
      changed,
      ...(set.email && { previousEmail: row.email }),
      ...(set.expertise && { expertise: set.expertise }),
    });
  }
  if (roleChanging) await record(AUDIT_ACTIONS.USER_ROLE_ASSIGNED, actor, target, { role, previousRole: row.role ?? null });
  if (switched) await record(switched, actor, target, { role: role ?? null });
  return account;
}

/**
 * Sets a new password for an account. Every session signed in before the change is refused
 * from then on (middleware/verifyToken), so a leaked password stops working everywhere.
 */
export async function resetPassword(actor, userId, password, confirmPassword) {
  requireDatabase();
  assertMayChange(actor, userId);
  const row = await loadAccount(userId);
  assertMayManage(actor, row);
  assertNewPassword(password, confirmPassword);

  const account = await transition(
    row,
    [ACCOUNT_STATUS.APPROVED, ACCOUNT_STATUS.DEACTIVATED],
    { password: await bcrypt.hash(password, BCRYPT_ROUNDS), credentialsChangedAt: new Date().toISOString() },
    'given a new password',
  );

  await record(AUDIT_ACTIONS.USER_PASSWORD_RESET, actor, row);
  return account;
}
