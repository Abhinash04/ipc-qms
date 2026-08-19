import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';

/**
 * `next` is unused but must be declared: Express identifies an error handler by
 * its arity, and dropping the fourth parameter turns this into ordinary
 * middleware that never runs. That is why the rule is disabled here, on this
 * line only.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // A failure that leaves no trace on the server cannot be diagnosed. 5xx is a
  // fault on our side, so it gets the stack; 4xx is the caller's and stays a
  // one-liner. Nothing here prints request bodies or headers, which is where
  // credentials would be.
  if (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    console.error(`[qms] ${req.method} ${req.originalUrl} -> ${status}:`, err.stack || err.message);
  } else {
    console.warn(`[qms] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

export default errorHandler;
