import HTTP_STATUS from '../constants/httpStatus.js';

function getHealth(req, res) {
  res.status(HTTP_STATUS.OK).json({
    status: 'healthy',
    service: 'qms-backend',
    timestamp: new Date().toISOString(),
  });
}

export { getHealth };
