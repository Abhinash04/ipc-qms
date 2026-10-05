import dns from 'node:dns';
import os from 'node:os';

/**
 * The network name of a computer, from its IP address (a reverse DNS lookup). Browsers never
 * send the computer's name, so this is the only way to name the device: on an office network
 * whose DNS registers its machines it gives e.g. "IPC-FO-PC07.ipc.local"; elsewhere it gives
 * nothing. Lookups are short and cached, so the audit trail never waits long on DNS.
 */

const TIMEOUT_MS = 400;
const FOUND_TTL_MS = 60 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5000;

const cache = new Map();

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

const withTimeout = (promise) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS).unref?.())]);

async function lookup(ip) {
  // A request from this same machine: its name is this server's.
  if (LOOPBACK.has(ip)) return os.hostname();
  try {
    const names = await withTimeout(dns.promises.reverse(ip.replace(/^::ffff:/, '')));
    return Array.isArray(names) && names[0] ? names[0] : null;
  } catch {
    return null;
  }
}

/** The device name for `ip`, or null when DNS has none. Never throws. */
export async function resolveHostname(ip) {
  if (!ip) return null;
  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.name;

  const name = await lookup(ip);
  cache.set(ip, { name, expires: Date.now() + (name ? FOUND_TTL_MS : MISSING_TTL_MS) });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return name;
}

/** For tests. */
export function clearHostnameCache() {
  cache.clear();
}
