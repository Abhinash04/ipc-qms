import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
const BCRYPT_ROUNDS = 10;
export function envKeyFor(userId) {
  return `QMS_PASSWORD_${String(userId || '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}
let fileCache = null;
let fileCacheFrom = null;
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

const sharedAllowed = () => {
  const envVal = String(process.env.QMS_ALLOW_SHARED_PASSWORD || '').trim().toLowerCase();
  if (envVal === 'true') return true;
  if (envVal === 'false') return false;
  return (process.env.NODE_ENV || 'development') !== 'production' && Boolean(process.env.QMS_SEED_PASSWORD);
};

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

export function hashFor(userId) {
  return hashOf(resolve(userId).password);
}

export function hasCredential(userId) {
  return Boolean(resolve(userId).password);
}

export function describeCredentials(users = []) {
  return users.map((user) => {
    const { source } = resolve(user.id);
    return { userId: user.id, email: user.email, configured: Boolean(source), source };
  });
}

export function reset() {
  fileCache = null;
  fileCacheFrom = null;
  hashCache.clear();
}

export { BCRYPT_ROUNDS };
