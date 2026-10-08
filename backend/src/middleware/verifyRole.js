import HTTP_STATUS from '../constants/httpStatus.js';
import { roleCanPerform } from '../constants/workflowActions.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

function recordDenial(req, reason) {
  void audit.record({
    action: AUDIT_ACTIONS.AUTHORIZATION_DENIED,
    result: AUDIT_RESULTS.DENIED,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    details: { method: req.method, path: req.originalUrl, reason },
  });
}

const unauthenticated = () =>
  Object.assign(new Error('Authentication required'), { status: HTTP_STATUS.UNAUTHORIZED });

const forbidden = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.FORBIDDEN });

export function verifyRole(...roles) {
  const allowed = roles.flat();

  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!allowed.includes(req.user.role)) {
      recordDenial(req, `role ${req.user.role} not in [${allowed.join(', ')}]`);
      return next(forbidden(`${req.user.role} is not permitted to use this endpoint`));
    }
    return next();
  };
}

export function verifyAction(action) {
  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roleCanPerform(req.user.role, action)) {
      recordDenial(req, `role ${req.user.role} may not perform ${action}`);
      return next(forbidden(`${req.user.role} may not perform ${action}`));
    }
    return next();
  };
}
