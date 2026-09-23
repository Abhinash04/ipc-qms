/**
 * Did a failed send reach the mail provider?
 *
 * The one question that decides whether sending again is safe, answered in one
 * place for every transport. Pure: no I/O, no models — transports import it to
 * label their own failures, and the outbox reads the label.
 *
 *   NOT_SENT   — provably never reached the provider. Retrying is safe.
 *   UNCERTAIN  — may have reached it. Retrying could email someone twice.
 *
 * A transport that knows better sets `error.delivery` itself (a NICeMail send
 * that failed before Send was pressed is NOT_SENT whatever the error says).
 * Everything else is decided from the network code and HTTP status:
 *
 *   - a 4xx, or a code proving no connection was made → NOT_SENT
 *   - a 5xx, or any other network code (reset, timeout) → UNCERTAIN
 *   - neither → a local error, raised before anything was sent (a missing
 *     credential, a bad template, a refused attachment) → NOT_SENT
 *
 * The last rule is why a transport that does not talk to a bare socket must
 * label its own uncoded failures rather than leave them here: an error this
 * cannot place falls to NOT_SENT, which is the wrong answer for a request that
 * may well have arrived. nicBrowserTransport labels its own.
 */

export const DELIVERY = { NOT_SENT: 'NOT_SENT', UNCERTAIN: 'UNCERTAIN' };

/**
 * Codes that mean the request never reached the provider. A DNS failure is the
 * one seen in practice: `getaddrinfo ENOTFOUND <mail host>`.
 */
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

/** Transient network trouble — worth one immediate retry, unlike a refused request. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
]);

/** Network codes that also mean "the provider is unreachable right now". */
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

/** The network error code, wherever the library put it. */
export function errorCode(error) {
  for (const candidate of [error?.code, error?.cause?.code, error?.error?.code]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return CODE_IN_MESSAGE.exec(String(error?.message || ''))?.[1] ?? null;
}

/** The HTTP status of a failed request, when there was a response at all. */
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

/** NOT_SENT because the network failed — the kind that often succeeds a second later. */
export function isTransientNetworkFailure(error) {
  if (classifyDelivery(error) !== DELIVERY.NOT_SENT) return false;
  const code = errorCode(error);
  return Boolean(code && TRANSIENT_NETWORK_CODES.has(code));
}

/**
 * Could the provider not be reached at all — as opposed to answering "no"?
 * Used for reads (the inbox poll), where the answer decides 503 vs 5xx.
 */
export function isUnreachable(error) {
  const status = errorStatus(error);
  if (status === 429 || (status !== null && status >= 500)) return true;
  const code = errorCode(error);
  return Boolean(code && UNREACHABLE_CODES.has(code));
}

/**
 * Did the provider refuse the credential, rather than fail to answer?
 *
 * A revoked or expired OAuth grant keeps failing however often it is retried,
 * so it must not be reported as a transient outage: somebody has to
 * re-authorise the mailbox.
 */
export function isAuthFailure(error) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return true;
  return /invalid_grant|invalid_client|unauthorized_client|Invalid credentials|EAUTH/i.test(
    String(error?.message || ''),
  );
}

/** A one-line reason that names the network code when the message hides it. */
export function describeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  const code = errorCode(error);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

/**
 * describeError, plus — for a sender that works in steps, as the NICeMail
 * browser agent does — the step it stopped at, what that step ran into, and
 * what was on the page. This one line is what the outbound record, the audit
 * trail, the HTTP response and the case page all show, so it has to say where
 * the send failed, not only that it did.
 */
export function describeFailure(error) {
  const reason = describeError(error);
  if (!error?.failedStep) return reason;
  const parts = [`stage: ${error.failedStep}`];
  const cause = error.cause ? String(error.cause.message || error.cause).split('\n')[0].slice(0, 200) : '';
  if (cause) parts.push(`cause: ${cause}`);
  if (error.seen) parts.push(`seen: ${String(error.seen).slice(0, 200)}`);
  return `${reason} [${parts.join('; ')}]`;
}

/** Label a transport's failure with what it knows, unless something already did. */
export function labelDelivery(error, delivery) {
  if (error && typeof error === 'object' && !error.delivery && !error.unconfirmed) {
    error.delivery = delivery;
  }
  return error;
}
