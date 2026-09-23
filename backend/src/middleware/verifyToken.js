import HTTP_STATUS from '../constants/httpStatus.js';
import authConfig from '../config/authConfig.js';
import { verifyToken as decodeToken } from '../services/auth/tokenService.js';

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
