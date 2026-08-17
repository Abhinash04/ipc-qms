const HTTP_STATUS = require('../constants/httpStatus');

function getHealth(req, res) {
  res.status(HTTP_STATUS.OK).json({
    status: 'healthy',
    service: 'qms-backend',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { getHealth };
