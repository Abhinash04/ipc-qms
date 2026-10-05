import HTTP_STATUS from '../constants/httpStatus.js';
import authConfig from '../config/authConfig.js';
import { verifyToken as decodeToken } from '../services/auth/tokenService.js';
import { cleanIp, setContextUser } from '../services/audit/requestContext.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

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

  req.user = user;
  setContextUser(user);
  return next();
}

export default verifyToken;
