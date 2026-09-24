import HTTP_STATUS from '../constants/httpStatus.js';
import * as emailService from '../services/email/emailService.js';
import * as caseMail from '../services/email/caseMail.js';
import { OUTCOMES } from '../services/email/outbox.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { isConnected } from '../config/db.js';

const OUTCOME_STATUS = {
  [OUTCOMES.SENT]: HTTP_STATUS.CREATED,
  [OUTCOMES.ALREADY_SENT]: HTTP_STATUS.OK,
  [OUTCOMES.IN_PROGRESS]: HTTP_STATUS.CONFLICT,
  [OUTCOMES.BLOCKED_UNCERTAIN]: HTTP_STATUS.CONFLICT,
  [OUTCOMES.FAILED]: HTTP_STATUS.SERVICE_UNAVAILABLE,
  [OUTCOMES.UNCERTAIN]: HTTP_STATUS.GATEWAY_TIMEOUT,
  NO_RECIPIENT: HTTP_STATUS.CONFLICT,
};

const OUTCOME_MESSAGE = {
  [OUTCOMES.IN_PROGRESS]: 'This email is being sent by another request. Refresh in a moment.',
};

const caseActor = (req) => ({ id: req.user?.id ?? null, role: req.user?.role ?? null });

function respondWithOutcome(res, { queryId, emailType, result }) {
  const status = OUTCOME_STATUS[result.outcome] ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const ok = result.outcome === OUTCOMES.SENT || result.outcome === OUTCOMES.ALREADY_SENT;
  const sent = result.sent || null;

  return res.status(status).json({
    queryId,
    emailType,
    outcome: result.outcome,
    ...(ok ? {} : { error: OUTCOME_MESSAGE[result.outcome] || result.error || 'The email was not sent.' }),
    ...(result.stage ? { stage: result.stage } : {}),
    ...(result.retryable ? { retryable: true } : {}),
    ...(result.configuration ? { configuration: true } : {}),
    ...(result.outcome === OUTCOMES.UNCERTAIN || result.outcome === OUTCOMES.BLOCKED_UNCERTAIN
      ? { unconfirmed: true }
      : {}),
    transport: sent?.transport || result.dispatch?.transport || null,
    sentAt: sent?.sentAt || result.dispatch?.sentAt || null,
    to: sent?.to || result.dispatch?.recipients || [],
    subject: sent?.subject || result.dispatch?.subject || null,
    providerMessageId: sent?.providerMessageId || result.dispatch?.providerMessageId || null,
    dispatch: result.dispatch || null,
  });
}

async function sendForCase(req, res, next, { emailType, send }) {
  const queryId = req.body?.queryId ?? null;
  if (!queryId) {
    return next(Object.assign(new Error('"queryId" is required'), { status: HTTP_STATUS.BAD_REQUEST }));
  }
  try {
    const result = await send({ queryId, actor: caseActor(req) });
    return respondWithOutcome(res, { queryId, emailType, result });
  } catch (error) {
    return next(error);
  }
}

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

async function sendAcknowledgement(req, res, next) {
  if (isConnected()) {
    return sendForCase(req, res, next, { emailType: 'ACKNOWLEDGEMENT', send: caseMail.acknowledge });
  }

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
  if (isConnected()) {
    return sendForCase(req, res, next, { emailType: 'FORWARD', send: caseMail.forward });
  }

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
  if (isConnected()) {
    return sendForCase(req, res, next, { emailType: 'OUTGOING_RESPONSE', send: caseMail.dispatchResponse });
  }

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
    });
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_REPLIED, queryId, result });
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    await auditSend({ req, action: AUDIT_ACTIONS.EMAIL_SEND_FAILED, queryId, error });
    next(error);
  }
}

export { getConfig, sendAcknowledgement, forwardQuery, sendResponse };
