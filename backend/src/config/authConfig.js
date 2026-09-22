import env from './env.js';
import { allUsers } from '../constants/users.js';
import { describeCredentials, envKeyFor } from '../services/auth/credentials.js';

/**
 * Authentication configuration.
 *
 * Follows the pattern established by config/env.js: a flat snapshot read from
 * process.env at import, plus a `validate*` that returns an array of error
 * strings and an `assert*` that throws — so server.js can fail fast the same
 * way it already does for email config.
 *
 * Nothing here is ever logged or returned over HTTP.
 */
const DEFAULT_TTL_SECONDS = 8 * 60 * 60; // 8 hours

const authConfig = {
  JWT_SECRET: process.env.JWT_SECRET || '',
  SEED_PASSWORD: process.env.QMS_SEED_PASSWORD || '',
  SESSION_TTL_SECONDS: parseInt(process.env.SESSION_TTL_SECONDS || String(DEFAULT_TTL_SECONDS), 10),
  COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'qms.session',
  // Cross-site deployments (frontend and API on different registrable domains)
  // need SameSite=None, which the browser only honours alongside Secure. Same
  // -site deployments should stay on Lax. Default is the safer Lax.
  COOKIE_SAMESITE: (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase(),
};

/**
 * The session cookie is httpOnly so no script can read it, which is also what
 * makes attachment previews work: `<img src>` / `<iframe src>` / `<a download>`
 * cannot attach an Authorization header, but the browser sends this cookie for
 * them automatically.
 */
export function cookieOptions() {
  const secure = env.NODE_ENV === 'production' || authConfig.COOKIE_SAMESITE === 'none';
  return {
    httpOnly: true,
    secure,
    sameSite: authConfig.COOKIE_SAMESITE,
    maxAge: authConfig.SESSION_TTL_SECONDS * 1000,
    path: '/',
  };
}

/** The legacy one-secret-opens-everything mode, off unless explicitly enabled. */
export function sharedPasswordEnabled() {
  return String(process.env.QMS_ALLOW_SHARED_PASSWORD || '').trim().toLowerCase() === 'true';
}

export function validateAuthConfig(config = authConfig) {
  const errors = [];

  if (!config.JWT_SECRET) {
    errors.push('JWT_SECRET is required — generate one with: openssl rand -base64 48');
  } else if (config.JWT_SECRET.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters (got ${config.JWT_SECRET.length})`);
  }

  /**
   * Every account needs its own credential.
   *
   * Checked at startup rather than at login, so a missing credential is a boot
   * failure naming the account, not a user who cannot sign in and is told only
   * "Invalid email or password".
   *
   * QMS_SEED_PASSWORD is no longer required on its own: it is a credential
   * source only under QMS_ALLOW_SHARED_PASSWORD=true, and that mode is what the
   * per-account hashes replaced.
   */
  const missing = describeCredentials(allUsers()).filter((row) => !row.configured);
  if (missing.length) {
    const named = missing.map((row) => `${row.userId} (${envKeyFor(row.userId)})`).join(', ');
    errors.push(
      `No sign-in credential configured for: ${named}. ` +
        'Set QMS_PASSWORDS_FILE to a JSON file of userId -> password outside the repository, ' +
        'or set the named environment variable for each account. ' +
        'QMS_ALLOW_SHARED_PASSWORD=true restores the old single-password behaviour, ' +
        'in which one secret opens every account including SUPER_ADMIN.',
    );
  }

  if (sharedPasswordEnabled() && !config.SEED_PASSWORD) {
    errors.push('QMS_ALLOW_SHARED_PASSWORD=true requires QMS_SEED_PASSWORD to be set');
  }

  if (!Number.isFinite(config.SESSION_TTL_SECONDS) || config.SESSION_TTL_SECONDS <= 0) {
    errors.push('SESSION_TTL_SECONDS must be a positive number of seconds');
  }

  if (!['lax', 'strict', 'none'].includes(config.COOKIE_SAMESITE)) {
    errors.push(`SESSION_COOKIE_SAMESITE must be lax, strict or none (got "${config.COOKIE_SAMESITE}")`);
  }

  return errors;
}

export function assertValidAuthConfig(config = authConfig) {
  const errors = validateAuthConfig(config);
  if (errors.length) {
    throw new Error(`Invalid auth configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

export default authConfig;
