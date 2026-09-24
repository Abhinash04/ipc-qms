export const DELIVERY = { NOT_SENT: 'NOT_SENT', UNCERTAIN: 'UNCERTAIN' };

const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EADDRNOTAVAIL',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const TRANSIENT_NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
]);

const UNREACHABLE_CODES = new Set([
  ...TRANSIENT_NETWORK_CODES,
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'TimeoutError',
  'AbortError',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const CODE_IN_MESSAGE =
  /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ECONNRESET|ETIMEDOUT|EPIPE)\b/;

export function errorCode(error) {
  for (const candidate of [error?.code, error?.cause?.code, error?.error?.code]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return CODE_IN_MESSAGE.exec(String(error?.message || ''))?.[1] ?? null;
}

export function errorStatus(error) {
  const status = error?.status ?? error?.response?.status;
  return typeof status === 'number' ? status : null;
}

export function classifyDelivery(error) {
  if (error?.delivery === DELIVERY.NOT_SENT || error?.delivery === DELIVERY.UNCERTAIN) {
    return error.delivery;
  }
  if (error?.unconfirmed) return DELIVERY.UNCERTAIN;

  const status = errorStatus(error);
  if (status !== null && status >= 400 && status < 500) return DELIVERY.NOT_SENT;
  if (status !== null && status >= 500) return DELIVERY.UNCERTAIN;

  const code = errorCode(error);
  if (code && NOT_SENT_CODES.has(code)) return DELIVERY.NOT_SENT;
  if (code) return DELIVERY.UNCERTAIN;

  return DELIVERY.NOT_SENT;
}

export function isTransientNetworkFailure(error) {
  if (classifyDelivery(error) !== DELIVERY.NOT_SENT) return false;
  const code = errorCode(error);
  return Boolean(code && TRANSIENT_NETWORK_CODES.has(code));
}

export function isUnreachable(error) {
  const status = errorStatus(error);
  if (status === 429 || (status !== null && status >= 500)) return true;
  const code = errorCode(error);
  return Boolean(code && UNREACHABLE_CODES.has(code));
}

export function isAuthFailure(error) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return true;
  return /invalid_grant|invalid_client|unauthorized_client|Invalid credentials|EAUTH/i.test(
    String(error?.message || ''),
  );
}

export function describeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  const code = errorCode(error);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

export function describeFailure(error) {
  const reason = describeError(error);
  if (!error?.failedStep) return reason;
  const parts = [`stage: ${error.failedStep}`];
  const cause = error.cause ? String(error.cause.message || error.cause).split('\n')[0].slice(0, 200) : '';
  if (cause) parts.push(`cause: ${cause}`);
  if (error.seen) parts.push(`seen: ${String(error.seen).slice(0, 200)}`);
  return `${reason} [${parts.join('; ')}]`;
}

export function labelDelivery(error, delivery) {
  if (error && typeof error === 'object' && !error.delivery && !error.unconfirmed) {
    error.delivery = delivery;
  }
  return error;
}
