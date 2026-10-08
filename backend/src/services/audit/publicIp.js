import env from '../../config/env.js';

const LOOKUP_URL = 'https://api.ipify.org?format=json';
const TIMEOUT_MS = 3000;
const REFRESH_MS = 15 * 60 * 1000;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

let current = null;
let timer = null;


export function isPrivateIp(ip) {
  const value = String(ip || '').replace(/^::ffff:/, '');
  const v4 = IPV4.exec(value);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = value.toLowerCase();
  return v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export function publicIpLookupEnabled() {
  const setting = String(process.env.AUDIT_PUBLIC_IP_LOOKUP || '').trim().toLowerCase();
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return !['production', 'test'].includes(env.NODE_ENV);
}


export const currentPublicIp = () => current;


export async function refreshPublicIp(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(LOOKUP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return current;
    const { ip } = await response.json();
    if (IPV4.test(String(ip || '')) && !isPrivateIp(ip)) current = ip;
  } catch {

  }
  return current;
}

export function startPublicIpLookup() {
  if (timer || !publicIpLookupEnabled()) return;
  void refreshPublicIp();
  timer = setInterval(() => void refreshPublicIp(), REFRESH_MS);
  timer.unref?.();
}

export function stopPublicIpLookup() {
  clearInterval(timer);
  timer = null;
}
