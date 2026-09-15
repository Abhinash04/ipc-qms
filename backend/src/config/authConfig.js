import env from './env.js';

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

export function validateAuthConfig(config = authConfig) {
  const errors = [];

  if (!config.JWT_SECRET) {
    errors.push('JWT_SECRET is required — generate one with: openssl rand -base64 48');
  } else if (config.JWT_SECRET.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters (got ${config.JWT_SECRET.length})`);
  }

  if (!config.SEED_PASSWORD) {
    errors.push('QMS_SEED_PASSWORD is required — it is the sign-in password for the seeded users');
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
