import HTTP_STATUS from '../constants/httpStatus.js';
import * as emailService from '../services/email/emailService.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { QueryCase } from '../models/index.js';
import { isConnected } from '../config/db.js';

/**
 * The mailbox a case's external mail must go out through — read from the
 * stored case, never from the request.
 *
 * The accept and final-approval paths already pass it. These two endpoints are
 * the case page's *retry* buttons, and they did not: a NICeMail case whose
 * acknowledgement or response had failed was retried through EMAIL_TRANSPORT —
 * Bhumika's Gmail — bypassing both the signed-in NICeMail session and its
 * outbound interlock. Taking it from the body instead would let a caller pick
 * which mailbox sends, so the case is the only authority.
 *
 * No case, no database, or a case from before the field existed: the default
 * transport, exactly as before.
 */
async function mailboxOf(queryId) {
  if (!queryId || !isConnected()) return null;
  const stored = await QueryCase.findOne({ queryId }, { sourceMailbox: 1 }).lean();
  return stored?.sourceMailbox ?? null;
}

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
    const result = await emailService.sendAcknowledgement({
      to,
      queryId,
      timestamp,
      sourceMailbox: await mailboxOf(queryId),
    });
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
  // Optional, and only ever used to look the case up: it names which case's
  // mailbox answers, and lets the audit row be traced back to that case.
  const queryId = req.body?.queryId ?? null;

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
      sourceMailbox: await mailboxOf(queryId),
    });
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_REPLIED, queryId, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, queryId, error });
    next(error);
  }
}

export { getConfig, sendEnquiry, sendAcknowledgement, forwardQuery, sendResponse };
