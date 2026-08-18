import HTTP_STATUS from '../constants/httpStatus.js';
import * as emailService from '../services/email/emailService.js';

function getConfig(req, res) {
  res.status(HTTP_STATUS.OK).json(emailService.getEmailConfig());
}

async function sendEnquiry(req, res, next) {
  try {
    const { subject, body, attachments, cc, timestamp } = req.body || {};
    const result = await emailService.sendEnquiry({ subject, body, attachments, cc, timestamp });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

async function sendAcknowledgement(req, res, next) {
  try {
    const { to, queryId, timestamp } = req.body || {};
    const result = await emailService.sendAcknowledgement({ to, queryId, timestamp });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

async function sendResponse(req, res, next) {
  try {
    const { to, subject, body, attachments, cc, timestamp, providerThreadId } = req.body || {};
    const result = await emailService.sendResponse({
      to,
      subject,
      body,
      attachments,
      cc,
      timestamp,
      providerThreadId,
    });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

export { getConfig, sendEnquiry, sendAcknowledgement, sendResponse };
