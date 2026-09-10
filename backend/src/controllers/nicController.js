import HTTP_STATUS from '../constants/httpStatus.js';
import {
  read_nicemail,
  send_nicemail,
  describeNicSetup,
} from '../services/email/nic/actions.js';

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
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

export { status, readMail, sendMail };
