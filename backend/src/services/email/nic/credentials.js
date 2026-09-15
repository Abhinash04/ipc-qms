import { readFile } from 'fs/promises';

/**
 * The NICeMail application password, and the redaction helper every NIC error
 * path must pass through.
 *
 * Two sources, in order of preference:
 *
 *   1. NIC_APP_PASSWORD_FILE — a path to a file outside the repository. This
 *      is the form a production deployment should use, because config then
 *      stores a path rather than a secret.
 *   2. NIC_APP_PASSWORD — the value itself. Simpler for development; the
 *      secret then lives in backend/.env, which is gitignored.
 *
 * Never read from argv: that leaks into shell history and `ps`.
 */

let cached = null;
let cachedFrom = null;

/**
 * Replace the secret anywhere it might surface.
 *
 * IMAP and SMTP servers echo parts of a failed AUTH exchange back, and
 * nodemailer includes the command in some errors, so no NIC error string may
 * reach a log, an API response or an audit record unredacted.
 */
export function redact(text, secret = cached) {
  const value = String(text ?? '');
  if (!secret) return value;
  return value.split(secret).join('«redacted»');
}

/**
 * Returns the password, or '' when none is configured.
 *
 * Empty is not an error here — the caller reports "no credential configured"
 * as an authentication-stage failure, which reads more usefully than a throw
 * from deep inside a connection attempt.
 */
export async function getPassword() {
  const file = (process.env.NIC_APP_PASSWORD_FILE || '').trim();
  const inline = process.env.NIC_APP_PASSWORD || '';

  const source = file ? `file:${file}` : inline ? 'env:NIC_APP_PASSWORD' : 'none';
  if (cached !== null && cachedFrom === source) return cached;

  if (file) {
    // .trim() so a trailing newline from `echo >` does not corrupt the secret.
    cached = (await readFile(file, 'utf8')).trim();
  } else {
    cached = inline.trim();
  }

  cachedFrom = source;
  return cached;
}

/** Which source supplied the credential — for diagnostics. Never the value. */
export function describeCredential() {
  const file = (process.env.NIC_APP_PASSWORD_FILE || '').trim();
  const inline = process.env.NIC_APP_PASSWORD || '';

  if (file) return { configured: true, source: 'NIC_APP_PASSWORD_FILE', path: file };
  if (inline) return { configured: true, source: 'NIC_APP_PASSWORD' };
  return { configured: false, source: null };
}

/** Drops the cache so a rotated credential is picked up without a restart. */
export function invalidate() {
  cached = null;
  cachedFrom = null;
}
