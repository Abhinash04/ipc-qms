import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { allUsers } from '../../constants/users.js';
import { hashFor, reset as resetCredentials, BCRYPT_ROUNDS } from './credentials.js';

/**
 * The seeded user directory.
 *
 * Each account authenticates against ITS OWN bcrypt hash, resolved by
 * services/auth/credentials.js. Passwords are never stored in source.
 *
 * This used to compare every account against a single hash of QMS_SEED_PASSWORD
 * that did not depend on the resolved user, which meant anyone holding one
 * account could sign in as any other — including SUPER_ADMIN — by submitting a
 * different address with their own password. The comparison below is bound to
 * the account `findByEmail` returned; that binding is the whole control.
 *
 * TODO(phase-2): move the directory itself to a Mongo collection, so accounts
 * can be added and deactivated without a redeploy.
 */

/**
 * A fixed hash of a random string, computed once.
 *
 * An unknown address, or a known account with no credential configured, is
 * compared against this rather than skipping the compare. bcrypt then costs the
 * same on every path, so a caller cannot distinguish "no such account" from
 * "wrong password" by timing — the property backend/src/test/auth.test.js
 * asserts. It can never match: nothing knows the random string.
 */
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);

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

  // Bound to THIS account. An unknown address, or an account with no credential
  // configured, falls to DUMMY_HASH so the bcrypt cost — and so the timing — is
  // identical on every path, and so neither can ever match.
  const expected = (user && hashFor(user.id)) || DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(String(password || ''), expected);

  if (!user || !passwordMatches) return null;
  return toPublicUser(user);
}

/** Test-only: drop memoised credential hashes so a changed environment applies. */
export function reset() {
  resetCredentials();
}

export { toPublicUser };
