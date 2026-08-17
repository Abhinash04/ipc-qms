const HTTP_STATUS = require('../constants/httpStatus');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;
