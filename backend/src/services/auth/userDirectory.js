import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { allUsers } from '../../constants/users.js';
import { hashFor, reset as resetCredentials, BCRYPT_ROUNDS } from './credentials.js';
import { isConnected } from '../../config/db.js';
import { User } from '../../models/User.js';

const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);
const normalise = (email) => String(email || '').trim().toLowerCase();
const toPublicUser = ({ id, name, email, role, divisionId }) => ({ id, name, email, role, divisionId });

// Self-registered accounts live only in MongoDB; the built-in directory is never stored there
// with a password (config/db.js seeds those rows without one).
const REGISTERED_FIELDS = 'userId name email role divisionId active password';
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
  return User.findOne({ email: wanted, password: { $type: 'string' } }).select(REGISTERED_FIELDS).lean();
}

/** A self-registered account an administrator has approved, as a public user, or null. */
export async function findApprovedById(id) {
  if (!id || !isConnected()) return null;
  const row = await User.findOne({ userId: id, password: { $type: 'string' } }).select(REGISTERED_FIELDS).lean();
  return row && isApproved(row) ? fromRegistered(row) : null;
}

/** An account can work only once an administrator has given it a role and left it active. */
export const isApproved = (row) => Boolean(row?.role) && row.active !== false;

/**
 * The account behind these credentials: `null` when they are wrong, otherwise the public user.
 * A self-registered account that is not approved yet comes back with `pending: true` and no role.
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
  if (!isApproved(row)) return { ...fromRegistered(row), role: null, pending: true };
  return fromRegistered(row);
}

export function reset() {
  resetCredentials();
}

export { toPublicUser };
