import HTTP_STATUS from '../constants/httpStatus.js';
import authConfig from '../config/authConfig.js';
import { verifyToken as decodeToken } from '../services/auth/tokenService.js';
import { setContextUser } from '../services/audit/requestContext.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

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
    audit.record({
      action: AUDIT_ACTIONS.AUTHENTICATION_FAILED,
      actorType: ACTOR_TYPES.HUMAN,
      result: AUDIT_RESULTS.DENIED,
      details: { reason: 'expired or invalid session', path: (req.originalUrl || '').split('?')[0] },
    });
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
