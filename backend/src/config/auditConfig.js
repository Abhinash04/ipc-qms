import env from './env.js';

/**
 * The audit chain is keyed with AUDIT_HMAC_SECRET. Without it no event can be
 * chained, so the server refuses to start, exactly as it does for JWT_SECRET.
 *
 * Every backend that writes to the same database must use the same value:
 * a row chained with one key fails verification under another.
 */
export function validateAuditConfig(config = env) {
  const errors = [];
  const secret = config.AUDIT_HMAC_SECRET || '';

  if (!secret) {
    errors.push(
      'AUDIT_HMAC_SECRET is required — generate one with: openssl rand -base64 48. ' +
        'Every backend sharing a database must use the same value.',
    );
  } else if (secret.length < 32) {
    errors.push(`AUDIT_HMAC_SECRET must be at least 32 characters (got ${secret.length})`);
  }

  return errors;
}

export function assertValidAuditConfig(config = env) {
  const errors = validateAuditConfig(config);
  if (errors.length) {
    throw new Error(`Invalid audit configuration:\n  - ${errors.join('\n  - ')}`);
  }
}
