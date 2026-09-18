import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';
import { IDENTITY_ROLES, identityForRole } from '../config/identities.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

/** Mailbox state changes, so an administrator can trace an email's handling. */
const recordMailbox = (req, action, message) =>
  audit.record({
    action,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    messageId: message?.mailboxMessageId ?? null,
    threadId: message?.providerThreadId ?? null,
    details: {
      from: message?.from ?? null,
      subject: message?.subject ?? null,
      attachments: Array.isArray(message?.attachments) ? message.attachments.length : 0,
    },
  });

const defaultRecipient = () =>
  identityForRole(IDENTITY_ROLES.FRONT_OFFICE)?.email || env.IPC_QUERY_EMAIL;
import * as mailbox from '../services/email/mailbox/index.js';
import * as decisions from '../services/email/mailbox/decisions.js';
import * as accept from '../services/email/mailbox/acceptMessage.js';
import { isConnected } from '../config/db.js';

/**
 * Decisions live in MongoDB and have no in-memory equivalent. Without a
 * connection, say so rather than letting Mongoose buffer the operation and
 * reject on a timeout — that surfaces as a 500, which blames the server for an
 * unavailable dependency. Mirrors `requireDb` in queryController.js.
 */
function requireDb(next) {
  if (isConnected()) return true;
  next(
    Object.assign(new Error('Mailbox decision storage is unavailable'), {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  );
  return false;
}

/**
 * The mailbox this request acts on, decided by who is signed in.
 *
 * The NICeMail mailbox's Front Officer always gets that mailbox — a query
 * parameter cannot point them anywhere else. Everyone else gets the primary
 * mailbox, where `?recipient=` still selects the address as it always has.
 */
async function resolveMailbox(req) {
  const own = await mailbox.forUser(req.user);
  if (own) return { ...own, describe: own.store.describe };

  const address = req.query.recipient || defaultRecipient();
  return { source: mailbox.describe().backend, address, store: mailbox, describe: mailbox.describe };
}

async function listMessages(req, res, next) {
  try {
    const box = await resolveMailbox(req);
    const unreadOnly = req.query.unreadOnly === 'true';
    const messages = await box.store.list(box.address, { unreadOnly });
    res.status(HTTP_STATUS.OK).json({ recipient: box.address, ...box.describe(), messages });
  } catch (error) {
    next(error);
  }
}

async function receiveMessage(req, res, next) {
  try {
    const { to, from, subject, body, attachments, cc, bcc, receivedAt } = req.body || {};
    const message = await mailbox.deliver({
      to: to || defaultRecipient(),
      from,
      subject,
      body,
      attachments,
      cc,
      bcc,
      receivedAt,
    });
    res.status(HTTP_STATUS.CREATED).json(message);
  } catch (error) {
    error.status = error.status || HTTP_STATUS.BAD_REQUEST;
    next(error);
  }
}

async function markIngested(req, res, next) {
  try {
    const box = await resolveMailbox(req);
    const message = await box.store.markIngested(box.address, req.params.messageId);
    if (!message) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: 'Message not found', messageId: req.params.messageId });
    }
    await recordMailbox(req, AUDIT_ACTIONS.EMAIL_RECEIVED, message);
    return res.status(HTTP_STATUS.OK).json(message);
  } catch (error) {
    return next(error);
  }
}

async function deleteMessage(req, res, next) {
  try {
    const box = await resolveMailbox(req);
    const message = await box.store.remove(box.address, req.params.messageId);
    if (!message) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: 'Message not found', messageId: req.params.messageId });
    }
    await recordMailbox(req, AUDIT_ACTIONS.EMAIL_DELETED, message);
    return res.status(HTTP_STATUS.OK).json({ deleted: true, message });
  } catch (error) {
    return next(error);
  }
}

async function resetMailbox(req, res, next) {
  try {
    await mailbox.reset();
    const stats = await mailbox.stats();
    res.status(HTTP_STATUS.OK).json({ reset: true, ...mailbox.describe(), ...stats });
  } catch (error) {
    next(error);
  }
}

/**
 * The Front Officer's accept/reject on one incoming message.
 *
 * This is the gate that separates "mail arrived" from "a case exists". The
 * server's job here is to make the decision durable and to make it happen only
 * once; the case itself is minted by the client's workflow store, which is
 * idempotent on the same message id.
 */
async function decideMessage(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const { decision, queryId, reason, message } = req.body;

    const result = await decisions.recordDecision({
      mailboxMessageId: req.params.messageId,
      decision,
      queryId: queryId ?? null,
      reason: reason ?? '',
      // From the session, never the body.
      decidedBy: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      message: message ?? {},
    });

    // Recorded whichever way it went: a rejection is as much a handling
    // decision as an acceptance, and is the one an administrator is most likely
    // to be asked about later.
    await recordMailbox(req, AUDIT_ACTIONS.EMAIL_CLASSIFIED, {
      mailboxMessageId: req.params.messageId,
      from: result.decision?.from,
      subject: result.decision?.subject,
    });

    return res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    return next(error);
  }
}

/**
 * The Front Officer accepts an incoming message: register the case, mint its
 * id, acknowledge the sender and forward to the Officer-in-Charge — one call.
 *
 * Reports what each step did rather than collapsing to success/failure. A case
 * that was created but not forwarded is a real, recoverable state, and saying
 * so is more useful than a 500 that loses the case id.
 */
async function acceptMessage(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const box = await resolveMailbox(req);
    let message = req.body;

    // A message read by the browser agent is already stored server-side, so
    // the case is built from that record rather than from what the client
    // echoes back — and a message that is not in this user's mailbox cannot
    // be accepted at all.
    if (box.source === 'nic-browser') {
      const stored = await box.store.get(box.address, req.params.messageId);
      if (!stored) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json({ error: 'Message not found', messageId: req.params.messageId });
      }
      message = stored;
    }

    const result = await accept.acceptMessage({
      mailboxMessageId: req.params.messageId,
      message,
      // From the session, never the body: this decides how the inquirer is
      // written back to for the whole life of the case.
      sourceMailbox: { source: box.source, address: box.address },
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
    });

    // Recorded whether or not every downstream step succeeded — the decision
    // itself is what happened, and it is what an auditor asks about.
    await decisions.recordDecision({
      mailboxMessageId: req.params.messageId,
      decision: 'ACCEPTED',
      queryId: result.queryId,
      decidedBy: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      message: {
        from: message?.from,
        subject: message?.subject,
        receivedAt: message?.receivedAt,
      },
    });

    await recordMailbox(req, AUDIT_ACTIONS.EMAIL_CLASSIFIED, {
      mailboxMessageId: req.params.messageId,
      from: message?.from,
      subject: message?.subject,
    });

    return res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listDecisions(req, res, next) {
  if (!requireDb(next)) return;

  try {
    return res.status(HTTP_STATUS.OK).json({ decisions: await decisions.listDecisions() });
  } catch (error) {
    return next(error);
  }
}

export {
  listMessages,
  receiveMessage,
  markIngested,
  deleteMessage,
  resetMailbox,
  decideMessage,
  acceptMessage,
  listDecisions,
};
