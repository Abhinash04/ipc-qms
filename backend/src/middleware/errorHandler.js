import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  if (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    console.error(`[qms] ${req.method} ${req.originalUrl} -> ${status}:`, err.stack || err.message);
  } else {
    console.warn(`[qms] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  const safeMessage =
    !err.status && env.NODE_ENV !== 'development'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(status).json({
    error: safeMessage,
    ...(err.details || {}),
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

export default errorHandler;
