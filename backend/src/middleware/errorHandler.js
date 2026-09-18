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

  // An error carrying an explicit `status` was thrown deliberately and its
  // message was written for the caller — including the 503 that says storage is
  // unavailable, which the frontend turns into an accurate toast. An error with
  // no status is whatever threw: a Mongoose error naming a collection, a driver
  // error carrying a connection string. Outside development that one is
  // replaced, and the full text is already on stderr above.
  const safeMessage =
    !err.status && env.NODE_ENV !== 'development'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(status).json({
    error: safeMessage,
    // Structured extras a thrower opts into (e.g. AttachmentUnavailableError's
    // `unavailableAttachments`) — never request bodies/headers, and only what
    // the error explicitly attached.
    ...(err.details || {}),
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

export default errorHandler;
