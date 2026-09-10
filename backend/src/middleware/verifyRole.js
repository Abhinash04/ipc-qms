import HTTP_STATUS from '../constants/httpStatus.js';
import { roleCanPerform } from '../constants/workflowActions.js';

/**
 * Authorization — step 3 of the chain in .claude/backend-rules.md.
 *
 * Both guards assume verifyToken ran first. If it did not, they fail closed
 * with 401 rather than letting an unauthenticated request through — a route
 * mis-wired to omit verifyToken should break loudly, not silently open.
 */

const unauthenticated = () =>
  Object.assign(new Error('Authentication required'), { status: HTTP_STATUS.UNAUTHORIZED });

const forbidden = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.FORBIDDEN });

/** Allow only these roles. Use for endpoints that are not workflow actions. */
export function verifyRole(...roles) {
  const allowed = roles.flat();

  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!allowed.includes(req.user.role)) {
      return next(forbidden(`${req.user.role} is not permitted to use this endpoint`));
    }
    return next();
  };
}

/**
 * Allow only roles that may perform this workflow action, per ROLE_ACTIONS.
 *
 * This is the role half of the frontend's `canPerform` only — the workflow
 * state half cannot be checked here yet. See constants/workflowActions.js.
 */
export function verifyAction(action) {
  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roleCanPerform(req.user.role, action)) {
      return next(forbidden(`${req.user.role} may not perform ${action}`));
    }
    return next();
  };
}
