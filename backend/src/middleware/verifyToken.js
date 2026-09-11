import HTTP_STATUS from '../constants/httpStatus.js';
import authConfig from '../config/authConfig.js';
import { verifyToken as decodeToken } from '../services/auth/tokenService.js';

/**
 * Authentication — step 2 of the chain in .claude/backend-rules.md.
 *
 * Reads the session JWT from the httpOnly cookie and puts the principal on
 * `req.user`. Applied per route rather than globally so that GET /health and
 * POST /auth/login stay public.
 *
 * 401 = missing or invalid credentials (this file).
 * 403 = authenticated but not permitted (verifyRole.js).
 */
function verifyToken(req, res, next) {
  const raw = req.cookies?.[authConfig.COOKIE_NAME];

  if (!raw) {
    return next(
      Object.assign(new Error('Authentication required'), { status: HTTP_STATUS.UNAUTHORIZED }),
    );
  }

  const user = decodeToken(raw);
  if (!user) {
    return next(
      Object.assign(new Error('Session is invalid or has expired'), {
        status: HTTP_STATUS.UNAUTHORIZED,
      }),
    );
  }

  req.user = user;
  return next();
}

export default verifyToken;
