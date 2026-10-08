import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { allUsers } from '../../constants/users.js';
import { hashFor, reset as resetCredentials, BCRYPT_ROUNDS } from './credentials.js';
import { isConnected } from '../../config/db.js';
import { User } from '../../models/User.js';
import { ACCOUNT_STATUS } from '../../constants/roles.js';

const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);
const normalise = (email) => String(email || '').trim().toLowerCase();
const toPublicUser = ({ id, name, email, role, divisionId }) => ({ id, name, email, role, divisionId });

// Self-registered accounts live only in MongoDB; the built-in directory is never stored there
// with a password (config/db.js seeds those rows without one).
const REGISTERED_FIELDS = 'userId name email role divisionId active status rejectionReason credentialsChangedAt password';
// What an administrator may see of a self-registered account: never the password hash.
export const PUBLIC_ACCOUNT_FIELDS =
  'userId name email department designation role divisionId expertise active status reviewedBy reviewedAt rejectionReason deactivatedAt lastLoginAt createdAt';
export const SELF_REGISTERED = { password: { $type: 'string' } };
const fromRegistered = (row) => ({
  id: row.userId,
  name: row.name,
  email: row.email,
  role: row.role ?? null,
  divisionId: row.divisionId ?? null,
});

export function findByEmail(email) {
  const wanted = normalise(email);
  if (!wanted) return null;
  return allUsers().find((user) => normalise(user.email) === wanted) || null;
}

export function findById(id) {
  return allUsers().find((user) => user.id === id) || null;
}

export function listUsers() {
  return allUsers().map(toPublicUser);
}

/** A self-registered account by email, with its password hash, or null. */
export async function findRegisteredByEmail(email) {
  const wanted = normalise(email);
  if (!wanted || !isConnected()) return null;
  return User.findOne({ email: wanted, ...SELF_REGISTERED }).select(REGISTERED_FIELDS).lean();
}

/**
 * Where a self-registered row stands. Rows registered before review existed carry no status:
 * no role means it was never approved, and `active: false` means it was switched off.
 */
export function statusOf(row) {
  if (!row) return null;
  if (row.status) return row.status;
  if (!row.role) return ACCOUNT_STATUS.PENDING;
  if (row.active === false) return ACCOUNT_STATUS.DEACTIVATED;
  return ACCOUNT_STATUS.APPROVED;
}

/** An account can work only once an administrator has approved it with a role. */
export const isApproved = (row) => statusOf(row) === ACCOUNT_STATUS.APPROVED && Boolean(row.role);

/**
 * A self-registered account an administrator has approved, as a public user, or null. Carries
 * `credentialsChangedAt` so a session older than the latest password reset can be refused.
 */
export async function findApprovedById(id) {
  if (!id || !isConnected()) return null;
  const row = await User.findOne({ userId: id, ...SELF_REGISTERED }).select(REGISTERED_FIELDS).lean();
  return row && isApproved(row) ? { ...fromRegistered(row), credentialsChangedAt: row.credentialsChangedAt ?? null } : null;
}

/**
 * The account behind these credentials: `null` when they are wrong, otherwise the public user.
 * A self-registered account that cannot sign in yet (or any more) comes back with no role and its
 * `status`, plus the reason it was rejected, so the caller can say why.
 */
export async function verifyCredentials(email, password) {
  const user = findByEmail(email);
  if (user) {
    const passwordMatches = await bcrypt.compare(String(password || ''), hashFor(user.id) || DUMMY_HASH);
    return passwordMatches ? toPublicUser(user) : null;
  }

  const row = await findRegisteredByEmail(email);
  const passwordMatches = await bcrypt.compare(String(password || ''), row?.password || DUMMY_HASH);
  if (!row || !passwordMatches) return null;
  if (!isApproved(row)) {
    return { ...fromRegistered(row), role: null, status: statusOf(row), rejectionReason: row.rejectionReason || null };
  }
  return fromRegistered(row);
}

/** True for an ID that belongs to the built-in directory rather than a self-registered account. */
export const isBuiltIn = (id) => Boolean(findById(id));

export function reset() {
  resetCredentials();
}

export { toPublicUser };
