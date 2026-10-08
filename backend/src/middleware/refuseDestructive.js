import HTTP_STATUS from '../constants/httpStatus.js';
import { isProduction } from '../config/env.js';
import { isSharedDatabase } from '../config/db.js';

function refuseDestructive(action) {
  return (req, res, next) => {
    const reason = isProduction()
      ? 'NODE_ENV=production'
      : isSharedDatabase()
        ? 'DATABASE_URL points at a shared database'
        : null;
    if (!reason) return next();
    return res.status(HTTP_STATUS.CONFLICT).json({ error: `${action} is refused when ${reason}.` });
  };
}

export default refuseDestructive;
