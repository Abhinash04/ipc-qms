import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

// Deliberately NOT importing config/authConfig.js: that module validates these
// credentials at startup, and importing it back would make the cycle real.
// QMS_SEED_PASSWORD is read from the environment directly, which is exactly
// what authConfig does with it.

/**
 * Per-account sign-in credentials.
 *
 * NO SECRETS HERE, and none in constants/users.js either. Follows the shape
 * services/email/nic/credentials.js already established for the NICeMail app
 * password: a file path is the production form, an environment variable is the
 * development fallback, and the describe* helper returns the SOURCE and never
 * the value.
 *
 * Resolution order, per account:
 *
 *   1. QMS_PASSWORDS_FILE — a JSON object of { "USR-0008": "…" }, at a path
 *      outside the repository. Config then stores a path rather than a secret.
 *   2. QMS_PASSWORD_<USER_ID> — e.g. QMS_PASSWORD_USR_0008. Simpler for
 *      development; the secret lives in backend/.env, which is gitignored.
 *   3. QMS_SEED_PASSWORD, but ONLY when QMS_ALLOW_SHARED_PASSWORD is the exact
 *      string "true". This is the pre-existing behaviour where one secret
 *      opened every account, including SUPER_ADMIN. It is retained so an
 *      existing deployment does not lock itself out on upgrade, and it is an
 *      explicit opt-in precisely so that nobody keeps it by accident.
 *
 * Never read from argv: that leaks into shell history and `ps`.
 */

const BCRYPT_ROUNDS = 10;

/** QMS_PASSWORD_USR_0008 for 'USR-0008'. */
export function envKeyFor(userId) {
  return `QMS_PASSWORD_${String(userId || '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

let fileCache = null;
let fileCacheFrom = null;

/** The parsed passwords file, or an empty object when none is configured. */
function passwordsFromFile() {
  const path = (process.env.QMS_PASSWORDS_FILE || '').trim();
  if (!path) {
    fileCache = null;
    fileCacheFrom = null;
    return {};
  }
  if (fileCache !== null && fileCacheFrom === path) return fileCache;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    // Fail loudly at boot rather than degrading every account to "no
    // credential", which would read as a wrong password and send whoever is
    // debugging it to the wrong place entirely.
    throw new Error(`QMS_PASSWORDS_FILE could not be read as JSON (${path}): ${error.message}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`QMS_PASSWORDS_FILE must contain a JSON object of userId -> password (${path})`);
  }

  fileCache = parsed;
  fileCacheFrom = path;
  return fileCache;
}

const sharedAllowed = () =>
  String(process.env.QMS_ALLOW_SHARED_PASSWORD || '').trim().toLowerCase() === 'true';

/**
 * The configured password for one account, with the source that supplied it.
 * `{ password: '', source: null }` when nothing is configured.
 */
function resolve(userId) {
  if (!userId) return { password: '', source: null };

  const fromFile = passwordsFromFile()[userId];
  if (typeof fromFile === 'string' && fromFile.trim()) {
    return { password: fromFile.trim(), source: 'QMS_PASSWORDS_FILE' };
  }

  const key = envKeyFor(userId);
  const fromEnv = (process.env[key] || '').trim();
  if (fromEnv) return { password: fromEnv, source: key };

  const shared = (process.env.QMS_SEED_PASSWORD || '').trim();
  if (sharedAllowed() && shared) {
    return { password: shared, source: 'QMS_SEED_PASSWORD (shared)' };
  }

  return { password: '', source: null };
}

/**
 * Hashes are memoised by the password VALUE, not by the account.
 *
 * bcrypt.hashSync at cost 10 is ~60ms; doing it per login would be a
 * self-inflicted rate limit. Keying on the value means a rotated secret takes
 * effect without a restart and the suite can mutate the environment freely,
 * while two accounts that share a password still cost one hash.
 */
const hashCache = new Map();

function hashOf(password) {
  if (!password) return null;
  let hash = hashCache.get(password);
  if (!hash) {
    hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    hashCache.set(password, hash);
  }
  return hash;
}

/** The bcrypt hash this account authenticates against, or null if unconfigured. */
export function hashFor(userId) {
  return hashOf(resolve(userId).password);
}

/** True when this account has any credential configured. */
export function hasCredential(userId) {
  return Boolean(resolve(userId).password);
}

/**
 * Which source supplied each account's credential — for startup validation and
 * diagnostics. Never the value.
 */
export function describeCredentials(users = []) {
  return users.map((user) => {
    const { source } = resolve(user.id);
    return { userId: user.id, email: user.email, configured: Boolean(source), source };
  });
}

/** Test-only: drop the memoised file contents and hashes. */
export function reset() {
  fileCache = null;
  fileCacheFrom = null;
  hashCache.clear();
}

export { BCRYPT_ROUNDS };
