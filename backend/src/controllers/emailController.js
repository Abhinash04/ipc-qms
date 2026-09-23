import HTTP_STATUS from '../constants/httpStatus.js';
import * as emailService from '../services/email/emailService.js';
import * as caseMail from '../services/email/caseMail.js';
import { OUTCOMES } from '../services/email/outbox.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { isConnected } from '../config/db.js';

/**
 * The retry buttons — the case page's acknowledgement and forward, the
 * Dispatch page's response — send through caseMail whenever the database is up,
 * which is always in production (config/db.js refuses to start without it).
 *
 * That makes them the same guarded send as intake and final approval: at most
 * once per case, to the recipient stored on the case, with the content the case
 * holds. The request names the case (`queryId`) and nothing else — a `to`,
 * `subject` or `body` in it is ignored, so a retry cannot address the wrong
 * person or say something that was never approved.
 *
 * Without a database (development, in-memory) there is no ledger to guard with,
 * and the body-driven send below is kept, as every other in-memory fallback is.
 */
const OUTCOME_STATUS = {
  [OUTCOMES.SENT]: HTTP_STATUS.CREATED,
  [OUTCOMES.ALREADY_SENT]: HTTP_STATUS.OK,
  // Another request holds the send, or an earlier one may already have sent it.
  [OUTCOMES.IN_PROGRESS]: HTTP_STATUS.CONFLICT,
  [OUTCOMES.BLOCKED_UNCERTAIN]: HTTP_STATUS.CONFLICT,
  // Provably not sent — the provider could not be reached. Retry is safe.
  [OUTCOMES.FAILED]: HTTP_STATUS.SERVICE_UNAVAILABLE,
  // Sent or not, nobody can yet say. Nothing is retried blindly.
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
    // The step the send stopped at, when the transport works in steps.
    ...(result.stage ? { stage: result.stage } : {}),
    ...(result.retryable ? { retryable: true } : {}),
    // Refused by configuration, not by the mailbox: a retry cannot succeed
    // until an environment variable changes.
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

/** Runs one guarded case send and answers with its outcome. */
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

  // Without a database, only used to trace the audit row back to its case.
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
