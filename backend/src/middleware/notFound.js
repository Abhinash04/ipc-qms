const HTTP_STATUS = require('../constants/httpStatus');

function notFound(req, res) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
}

module.exports = notFound;
