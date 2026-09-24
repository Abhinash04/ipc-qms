import HTTP_STATUS from '../constants/httpStatus.js';
import { isProduction } from '../config/env.js';
import { IDENTITY_ROLES, identityForRole } from '../config/identities.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';

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

const defaultRecipient = () => identityForRole(IDENTITY_ROLES.FRONT_OFFICE)?.email;
import * as mailbox from '../services/email/mailbox/index.js';
import * as decisions from '../services/email/mailbox/decisions.js';
import * as triage from '../services/email/mailbox/triage.js';
import * as accept from '../services/email/mailbox/acceptMessage.js';
import * as health from '../services/email/mailbox/health.js';
import { matchesSearch, toMessageViews } from '../services/email/mailbox/messageView.js';
import { sendAttachment } from './attachmentController.js';
import { describeError, isUnreachable, isAuthFailure } from '../services/email/delivery.js';
import { isConnected } from '../config/db.js';

function requireDb(next) {
  if (isConnected()) return true;
  next(
    Object.assign(new Error('Mailbox decision storage is unavailable'), {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  );
  return false;
}

async function resolveMailbox(req) {
  const own = await mailbox.forUser(req.user);
  if (own) return { ...own, describe: own.store.describe, own: true };

  const address = req.query.recipient || defaultRecipient();
  return { source: mailbox.describe().backend, address, store: mailbox, describe: mailbox.describe };
}

function mailboxUnavailable(error, { source, label }) {
  if (isAuthFailure(error)) {
    return Object.assign(
      new Error(
        `The ${label} rejected the Front Office credential: ${describeError(error)}. ` +
          (source === 'nic-browser'
            ? 'Sign in to that mailbox in the dedicated Chrome, then retry.'
            : 'Re-authenticate the mailbox.'),
      ),
      { status: HTTP_STATUS.BAD_GATEWAY, details: { retryable: false, sync: health.snapshot() } },
    );
  }

  if (isUnreachable(error)) {
    return Object.assign(
      new Error(`The ${label} could not be reached: ${describeError(error)}. The poll keeps retrying.`),
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, details: { retryable: true, sync: health.snapshot() } },
    );
  }

  return error;
}

const newestFirst = (a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? ''));

async function listPage(box, { unreadOnly, junkOnly, q, limit, offset }) {
  if (box.own) {
    const messages = await box.store.list(box.address, { unreadOnly, junkOnly, q, limit, offset });
    const total = limit ? await box.store.count(box.address, { unreadOnly, junkOnly, q }) : messages.length;
    return { messages, total };
  }

  const all = (await box.store.list(box.address, { unreadOnly })).filter((message) => matchesSearch(message, q));
  const messages = limit ? [...all].sort(newestFirst).slice(offset, offset + limit) : all;
  return { messages, total: all.length };
}

async function listMessages(req, res, next) {
  let box;

  try {
    box = await resolveMailbox(req);
    const { unreadOnly, junkOnly, q, limit, offset } = req.validatedQuery;
    const { messages, total } = await listPage(box, { unreadOnly, junkOnly, q, limit, offset });

    health.recordSuccess({ source: box.source, address: box.address });

    const described = box.describe();
    res.status(HTTP_STATUS.OK).json({
      recipient: box.address,
      ...described,
      messages: await toMessageViews(messages, { keepsReadState: Boolean(box.own) }),
      ...(limit ? { total, limit, offset } : {}),
      sync: described.sync ?? health.snapshot(),
    });
  } catch (error) {
    if (!box) return next(error);

    health.recordFailure({ source: box.source, address: box.address, error });
    const unavailable = mailboxUnavailable(error, { source: box.source, label: `${box.source} mailbox` });
    if (unavailable !== error) res.set('Retry-After', '30');
    return next(unavailable);
  }
}

function refuseInProduction(res, endpoint) {
  if (!isProduction()) return false;
  res.status(HTTP_STATUS.CONFLICT).json({
    error: `${endpoint} is a development affordance and is refused when NODE_ENV=production.`,
  });
  return true;
}

async function receiveMessage(req, res, next) {
  if (refuseInProduction(res, 'POST /mailbox/receive')) return;
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

async function rescueMessage(req, res, next) {
  if (!requireDb(next)) return undefined;
  try {
    const box = await resolveMailbox(req);
    const message = await box.store.get?.(box.address, req.params.messageId);

    const row = await triage.rescue(req.params.messageId, { userId: req.user?.id ?? null });
    if (!row) return messageNotFound(res, req.params.messageId);

    await recordMailbox(req, AUDIT_ACTIONS.EMAIL_CLASSIFIED, message ?? { mailboxMessageId: req.params.messageId });
    return res.status(HTTP_STATUS.OK).json({ rescued: true, triage: row });
  } catch (error) {
    return next(error);
  }
}

const messageNotFound = (res, messageId) =>
  res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Message not found', messageId });

const mailboxError = (box, error) =>
  box ? mailboxUnavailable(error, { source: box.source, label: `${box.source} mailbox` }) : error;
async function getMessage(req, res, next) {
  let box;
  try {
    box = await resolveMailbox(req);
    const message = await box.store.get(box.address, req.params.messageId);
    if (!message) return messageNotFound(res, req.params.messageId);

    const [view] = await toMessageViews([message], { keepsReadState: Boolean(box.own) });
    return res.status(HTTP_STATUS.OK).json({ ...view, bodyHtml: message.bodyHtml ?? null });
  } catch (error) {
    return next(mailboxError(box, error));
  }
}

async function downloadMessageAttachment(req, res, next) {
  let box;
  try {
    box = await resolveMailbox(req);
    const { messageId, attachmentId } = req.params;
    const message = await box.store.get(box.address, messageId);
    const entry = message?.attachments?.find((attachment) => attachment?.attachmentId === attachmentId);
    if (!entry) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: 'Attachment not found on this message', messageId, attachmentId });
    }
    return await sendAttachment(req, res, entry.attachmentId, { messageId: message.mailboxMessageId });
  } catch (error) {
    return next(mailboxError(box, error));
  }
}

async function markRead(req, res, next) {
  let box;
  try {
    box = await resolveMailbox(req);
    const { messageId } = req.params;
    if (!box.own) {
      return res
        .status(HTTP_STATUS.CONFLICT)
        .json({ error: `The ${box.source} mailbox keeps no QMS read state.`, messageId });
    }

    const result = await box.store.markRead(box.address, messageId, req.user);
    if (!result) return messageNotFound(res, messageId);
    if (result.changed) await recordMailbox(req, AUDIT_ACTIONS.EMAIL_MARKED_READ, result.message);

    const [view] = await toMessageViews([result.message], { keepsReadState: true });
    return res.status(HTTP_STATUS.OK).json(view);
  } catch (error) {
    return next(mailboxError(box, error));
  }
}

async function syncMailbox(req, res, next) {
  try {
    const box = await resolveMailbox(req);
    if (!box.own) {
      return res
        .status(HTTP_STATUS.OK)
        .json({ supported: false, started: false, sync: box.describe().sync ?? health.snapshot() });
    }

    const result = box.store.requestSync(box.address);
    if (result.started) {
      await audit.record({
        action: AUDIT_ACTIONS.SYNC_STARTED,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        details: { source: box.source, address: box.address },
      });
    }
    return res.status(HTTP_STATUS.ACCEPTED).json({ supported: true, ...result });
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

async function decideMessage(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const { decision, queryId, reason, message } = req.body;

    const result = await decisions.recordDecision({
      mailboxMessageId: req.params.messageId,
      decision,
      queryId: queryId ?? null,
      reason: reason ?? '',
      decidedBy: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      message: message ?? {},
    });

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

async function acceptMessage(req, res, next) {
  if (!requireDb(next)) return;

  try {
    const box = await resolveMailbox(req);
    let message = req.body;
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
      sourceMailbox: { source: box.source, address: box.address },
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
    });

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
  getMessage,
  downloadMessageAttachment,
  markRead,
  syncMailbox,
  rescueMessage,
};
