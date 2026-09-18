import bcrypt from 'bcryptjs';
import { allUsers } from '../../constants/users.js';
import authConfig from '../../config/authConfig.js';

/**
 * The seeded user directory.
 *
 * Every account shares one bcrypt hash derived from QMS_SEED_PASSWORD, which
 * keeps the demo ergonomics of the old shared password while removing the
 * plaintext secret from source control. The hash is computed once, lazily, so
 * importing this module in a test that never authenticates costs nothing.
 *
 * TODO(phase-2): replace with per-user credentials in a Mongo collection.
 */
const BCRYPT_ROUNDS = 10;

let cachedHash = null;
let cachedFor = null;

function seedHash() {
  // Re-derive if the configured password changed (tests mutate authConfig).
  if (cachedHash === null || cachedFor !== authConfig.SEED_PASSWORD) {
    cachedFor = authConfig.SEED_PASSWORD;
    cachedHash = bcrypt.hashSync(authConfig.SEED_PASSWORD, BCRYPT_ROUNDS);
  }
  return cachedHash;
}

const normalise = (email) => String(email || '').trim().toLowerCase();

/** The shape put into a JWT and returned to the client. Never includes secrets. */
const toPublicUser = ({ id, name, email, role, divisionId }) => ({ id, name, email, role, divisionId });

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

/**
 * Returns the public user on success, or null on any failure.
 *
 * The bcrypt comparison runs even when the email is unknown, so a caller
 * cannot distinguish "no such account" from "wrong password" by timing. The
 * controller likewise returns one message for both.
 */
export async function verifyCredentials(email, password) {
  const user = findByEmail(email);
  const passwordMatches = await bcrypt.compare(String(password || ''), seedHash());

  if (!user || !passwordMatches) return null;
  return toPublicUser(user);
}

/** Test-only: drop the memoised hash so a changed SEED_PASSWORD takes effect. */
export function reset() {
  cachedHash = null;
  cachedFor = null;
}

export { toPublicUser };
