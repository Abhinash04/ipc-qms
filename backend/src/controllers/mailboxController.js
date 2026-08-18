import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';
import * as mailbox from '../services/email/mailbox/index.js';

async function listMessages(req, res, next) {
  try {
    const recipient = req.query.recipient || env.IPC_QUERY_EMAIL;
    const unreadOnly = req.query.unreadOnly === 'true';
    const messages = await mailbox.list(recipient, { unreadOnly });
    res.status(HTTP_STATUS.OK).json({ recipient, ...mailbox.describe(), messages });
  } catch (error) {
    next(error);
  }
}

async function receiveMessage(req, res, next) {
  try {
    const { to, from, subject, body, attachments, cc, bcc, receivedAt } = req.body || {};
    const message = await mailbox.deliver({
      to: to || env.IPC_QUERY_EMAIL,
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
    const recipient = req.query.recipient || env.IPC_QUERY_EMAIL;
    const message = await mailbox.markIngested(recipient, req.params.messageId);
    if (!message) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ error: 'Message not found', messageId: req.params.messageId });
    }
    return res.status(HTTP_STATUS.OK).json(message);
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

export { listMessages, receiveMessage, markIngested, resetMailbox };
