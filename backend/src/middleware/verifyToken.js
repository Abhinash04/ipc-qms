import HTTP_STATUS from '../constants/httpStatus.js';
import authConfig from '../config/authConfig.js';
import { verifyToken as decodeToken } from '../services/auth/tokenService.js';
import { cleanIp, setContextUser } from '../services/audit/requestContext.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { findApprovedById } from '../services/auth/userDirectory.js';

// A tab that keeps polling on an expired session, or a client sending made-up cookies, would
// otherwise add one event per request; once a minute per address is enough to show it.
const REJECTED_THROTTLE_MS = 60 * 1000;
const recentRejections = new Map();

function firstRejectionThisMinute(ip) {
  const now = Date.now();
  if (now - (recentRejections.get(ip) || 0) < REJECTED_THROTTLE_MS) return false;
  recentRejections.set(ip, now);
  if (recentRejections.size > 2000) recentRejections.delete(recentRejections.keys().next().value);
  return true;
}

/** For tests. */
export function clearRejectedSessionThrottle() {
  recentRejections.clear();
}

const sessionRefused = () =>
  Object.assign(new Error('Session is invalid or has expired'), { status: HTTP_STATUS.UNAUTHORIZED });

/**
 * A self-registered account is re-read on every request, so deactivating it or changing its role
 * takes effect at once rather than when the session expires. Fails closed: if the account cannot
 * be confirmed as approved (including while the database is unreachable), the session is refused.
 */
// JWT `iat` is in whole seconds, so compare at that granularity.
const issuedBeforeReset = (user, current) =>
  Boolean(current.credentialsChangedAt) &&
  (user.issuedAt ?? 0) < Math.floor(Date.parse(current.credentialsChangedAt) / 1000);

async function withCurrentAccount(req, user, next) {
  try {
    const current = await findApprovedById(user.id);
    if (!current || issuedBeforeReset(user, current)) {
      audit.record({
        action: AUDIT_ACTIONS.AUTHENTICATION_FAILED,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: user.id,
        actorRole: user.role,
        result: AUDIT_RESULTS.DENIED,
        details: { reason: 'account is no longer approved', path: (req.originalUrl || '').split('?')[0] },
      });
      return next(sessionRefused());
    }
    const fresh = { ...user, role: current.role, name: current.name, email: current.email };
    req.user = fresh;
    setContextUser(fresh);
    return next();
  } catch (error) {
    return next(error);
  }
}

function verifyToken(req, res, next) {
  const raw = req.cookies?.[authConfig.COOKIE_NAME];

  if (!raw) {
    return next(
      Object.assign(new Error('Authentication required'), { status: HTTP_STATUS.UNAUTHORIZED }),
    );
  }

  const user = decodeToken(raw);
  if (!user) {
    // A presented but expired or forged session is a security event; a missing one is not.
    if (firstRejectionThisMinute(cleanIp(req.ip || req.socket?.remoteAddress))) {
      audit.record({
        action: AUDIT_ACTIONS.AUTHENTICATION_FAILED,
        actorType: ACTOR_TYPES.HUMAN,
        result: AUDIT_RESULTS.DENIED,
        details: { reason: 'expired or invalid session', path: (req.originalUrl || '').split('?')[0] },
      });
    }
    return next(
      Object.assign(new Error('Session is invalid or has expired'), {
        status: HTTP_STATUS.UNAUTHORIZED,
      }),
    );
  }

  if (user.registered) return withCurrentAccount(req, user, next);

  req.user = user;
  setContextUser(user);
  return next();
}

export default verifyToken;
