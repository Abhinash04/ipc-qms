import { readFile } from 'fs/promises';

let cached = null;
let cachedFrom = null;

export function redact(text, secret = cached) {
  const value = String(text ?? '');
  if (!secret) return value;
  return value.split(secret).join('«redacted»');
}

export async function getPassword() {
  const file = (process.env.NIC_APP_PASSWORD_FILE || '').trim();
  const inline = process.env.NIC_APP_PASSWORD || '';

  const source = file ? `file:${file}` : inline ? 'env:NIC_APP_PASSWORD' : 'none';
  if (cached !== null && cachedFrom === source) return cached;

  if (file) {
    cached = (await readFile(file, 'utf8')).trim();
  } else {
    cached = inline.trim();
  }

  cachedFrom = source;
  return cached;
}

export function describeCredential() {
  const file = (process.env.NIC_APP_PASSWORD_FILE || '').trim();
  const inline = process.env.NIC_APP_PASSWORD || '';

  if (file) return { configured: true, source: 'NIC_APP_PASSWORD_FILE', path: file };
  if (inline) return { configured: true, source: 'NIC_APP_PASSWORD' };
  return { configured: false, source: null };
}

export function invalidate() {
  cached = null;
  cachedFrom = null;
}
