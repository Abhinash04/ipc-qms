import HTTP_STATUS from '../constants/httpStatus.js';
import * as emailService from '../services/email/emailService.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

/**
 * Every send is audited, successes and failures alike. A send that failed is
 * the record an administrator most needs — it is the difference between "the
 * inquirer was never told" and "we do not know what happened".
 *
 * Recorded: who, what, which case, how many recipients and attachments. Never
 * recorded: message bodies, addresses beyond a count, credentials.
 */
const actorFrom = (req) => ({
  actorType: ACTOR_TYPES.HUMAN,
  actorId: req.user?.id ?? null,
  actorRole: req.user?.role ?? null,
});

function auditSend({ req, action, queryId = null, result, error = null }) {
  return audit.record({
    action,
    ...actorFrom(req),
    queryId,
    result: error ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
    error: error ? error.message : null,
    messageId: result?.providerMessageId ?? null,
    threadId: result?.providerThreadId ?? null,
    details: result
      ? {
          transport: result.transport ?? null,
          recipients: Array.isArray(result.to) ? result.to.length : result.to ? 1 : 0,
          attachments: Array.isArray(result.attachments) ? result.attachments.length : 0,
        }
      : null,
  });
}

function getConfig(req, res) {
  res.status(HTTP_STATUS.OK).json(emailService.getEmailConfig());
}

async function sendEnquiry(req, res, next) {
  try {
    const { subject, body, attachments, cc, timestamp } = req.body || {};
    const result = await emailService.sendEnquiry({ subject, body, attachments, cc, timestamp });
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SENT, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, error });
    next(error);
  }
}

async function sendAcknowledgement(req, res, next) {
  try {
    const { to, queryId, timestamp } = req.body || {};
    const result = await emailService.sendAcknowledgement({ to, queryId, timestamp });
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SENT, queryId, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, queryId: req.body?.queryId, error });
    next(error);
  }
}

async function forwardQuery(req, res, next) {
  const { queryId, subject, body, timestamp, providerThreadId, attachments } = req.body || {};

  try {
    if (!queryId) {
      throw Object.assign(new Error('"queryId" is required'), { status: 400 });
    }
    const result = await emailService.forwardToOfficerInCharge({
      queryId,
      subject,
      body,
      timestamp,
      providerThreadId,
      attachments,
    });
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_FORWARDED, queryId, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    error.status = error.status || HTTP_STATUS.BAD_REQUEST;
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, queryId, error });
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
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_REPLIED, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, error });
    next(error);
  }
}

export { getConfig, sendEnquiry, sendAcknowledgement, forwardQuery, sendResponse };
