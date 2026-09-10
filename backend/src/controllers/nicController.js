import HTTP_STATUS from '../constants/httpStatus.js';
import {
  read_nicemail,
  send_nicemail,
  describeNicSetup,
} from '../services/email/nic/actions.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

/**
 * The stage vocabulary (`connect`, `authenticate`, `open_mailbox`, `fetch`,
 * `submit`) was previously returned to the caller and then discarded. Recording
 * it turns one-off diagnostics into a history — which is what tells an
 * administrator whether NICeMail is intermittently unreachable or the
 * credential has expired.
 */
const recordNic = (req, action, result) =>
  audit.record({
    action,
    actorType: ACTOR_TYPES.AGENT,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    result: result?.ok ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.FAILURE,
    error: result?.ok ? null : result?.error ?? null,
    details: { stage: result?.stage ?? null, count: result?.messages?.length ?? null },
  });

/**
 * The NICeMail agent actions, exposed over HTTP.
 *
 * A failed action is not a failed request: the response is 200 carrying
 * `{ ok: false, stage, error }`. The caller needs to know *which stage* failed
 * — connect, authenticate, or submit — and collapsing that into a 4xx/5xx
 * would throw the distinction away, which is the one thing this endpoint
 * exists to preserve.
 */

function status(req, res) {
  res.status(HTTP_STATUS.OK).json(describeNicSetup());
}

async function readMail(req, res, next) {
  try {
    const result = await read_nicemail({ limit: req.body?.limit ?? 1 });
    await recordNic(req, AUDIT_ACTIONS.EMAIL_READ, result);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

async function sendMail(req, res, next) {
  try {
    const { to, subject, body } = req.body || {};
    // The recipient allow-list lives in the action, not here, so it applies
    // however the action is reached.
    const result = await send_nicemail({ to, subject, body });
    await recordNic(req, AUDIT_ACTIONS.EMAIL_SENT, result);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

export { status, readMail, sendMail };
