import HTTP_STATUS from '../constants/httpStatus.js';

function notFound(req, res) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
}

export default notFound;
