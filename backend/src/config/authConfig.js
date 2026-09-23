import env from './env.js';
import { allUsers } from '../constants/users.js';
import { describeCredentials, envKeyFor } from '../services/auth/credentials.js';

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

const authConfig = {
  JWT_SECRET: process.env.JWT_SECRET || '',
  SEED_PASSWORD: process.env.QMS_SEED_PASSWORD || '',
  SESSION_TTL_SECONDS: parseInt(process.env.SESSION_TTL_SECONDS || String(DEFAULT_TTL_SECONDS), 10),
  COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'qms.session',
  COOKIE_SAMESITE: (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase(),
};

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

export function sharedPasswordEnabled() {
  const envVal = String(process.env.QMS_ALLOW_SHARED_PASSWORD || '').trim().toLowerCase();
  if (envVal === 'true') return true;
  if (envVal === 'false') return false;
  return (process.env.NODE_ENV || 'development') !== 'production' && Boolean(process.env.QMS_SEED_PASSWORD);
}

export function validateAuthConfig(config = authConfig) {
  const errors = [];

  if (!config.JWT_SECRET) {
    errors.push('JWT_SECRET is required — generate one with: openssl rand -base64 48');
  } else if (config.JWT_SECRET.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters (got ${config.JWT_SECRET.length})`);
  }

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
