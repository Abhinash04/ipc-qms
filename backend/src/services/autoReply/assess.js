import env from '../../config/env.js';
import { isConnected } from '../../config/db.js';
import { MailboxMessage } from '../../models/MailboxMessage.js';
import { MailboxTriage, TRIAGE_VERDICTS } from '../../models/MailboxTriage.js';
import { MailboxDecision } from '../../models/MailboxDecision.js';
import * as audit from '../audit/auditService.js';
import { AUDIT_ACTIONS } from '../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { MATCHER, matchAutoReply } from './matcher.js';

/**
 * Looks at each new mail once and records on it (MailboxMessage.autoReply) whether it can be
 * offered an automatic reply. Nothing is sent here: a reply goes out only when the Front Office
 * approves it (approve.js).
 */

export const AUTO_REPLY_STATUS = Object.freeze({
  SUGGESTED: 'SUGGESTED',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  APPROVING: 'APPROVING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DECLINED: 'DECLINED',
});

/** The statuses that keep a mail in the Auto Reply bucket; every other mail is for a person. */
export const AUTO_REPLY_BUCKET = Object.freeze([
  AUTO_REPLY_STATUS.SUGGESTED,
  AUTO_REPLY_STATUS.APPROVING,
  AUTO_REPLY_STATUS.FAILED,
  AUTO_REPLY_STATUS.SENT,
]);

const SOURCES = ['nic-browser'];
const BACKLOG_BATCH = 100;

async function assessOne(message, { decided, junk, nowIso }) {
  const threshold = env.AUTO_REPLY_CONFIDENCE_THRESHOLD;
  const match = decided ? null : matchAutoReply(message, { threshold, junk });
  const common = { threshold, matcher: MATCHER, checkedAt: nowIso };

  const autoReply = match?.eligible
    ? {
        ...common,
        status: AUTO_REPLY_STATUS.SUGGESTED,
        confidence: match.confidence,
        entryId: match.entryId,
        topic: match.topic,
        question: match.question,
        draft: match.draft,
        reason: match.reason,
      }
    : {
        ...common,
        status: AUTO_REPLY_STATUS.NOT_ELIGIBLE,
        confidence: match?.confidence ?? 0,
        entryId: match?.entryId ?? null,
        reason: match ? match.reason : 'already handled through the standard workflow',
      };

  const { modifiedCount } = await MailboxMessage.updateOne(
    { mailboxMessageId: message.mailboxMessageId, autoReply: null },
    { $set: { autoReply } },
  );

  if (modifiedCount && autoReply.status === AUTO_REPLY_STATUS.SUGGESTED) {
    await audit.record({
      action: AUDIT_ACTIONS.AUTO_REPLY_SUGGESTED,
      actorType: ACTOR_TYPES.SYSTEM,
      messageId: message.mailboxMessageId,
      details: {
        entryId: autoReply.entryId,
        topic: autoReply.topic,
        confidence: autoReply.confidence,
        threshold,
        from: message.from ?? null,
        subject: message.subject ?? null,
      },
    });
  }
  return modifiedCount ? autoReply.status : null;
}

/** Assesses the given mailbox messages that have not been assessed yet. */
export async function assess(ids = [], { now = Date.now() } = {}) {
  const counts = { suggested: 0, notEligible: 0 };
  if (!env.AUTO_REPLY_ENABLED || !ids.length || !isConnected()) return counts;

  const messages = await MailboxMessage.find({ mailboxMessageId: { $in: ids }, autoReply: null, purgedAt: null, removedAt: null })
    .select('mailboxMessageId from subject body attachments')
    .lean();
  if (!messages.length) return counts;

  const found = messages.map((message) => message.mailboxMessageId);
  const [decisions, triage] = await Promise.all([
    MailboxDecision.find({ mailboxMessageId: { $in: found } }).select('mailboxMessageId').lean(),
    MailboxTriage.find({ mailboxMessageId: { $in: found } }).select('mailboxMessageId verdict rescuedAt').lean(),
  ]);
  const decided = new Set(decisions.map((row) => row.mailboxMessageId));
  const junk = new Set(
    triage.filter((row) => row.verdict === TRIAGE_VERDICTS.JUNK && !row.rescuedAt).map((row) => row.mailboxMessageId),
  );

  const nowIso = new Date(now).toISOString();
  for (const message of messages) {
    const id = message.mailboxMessageId;
    const status = await assessOne(message, { decided: decided.has(id), junk: junk.has(id), nowIso });
    if (status === AUTO_REPLY_STATUS.SUGGESTED) counts.suggested += 1;
    else if (status) counts.notEligible += 1;
  }
  return counts;
}

/** Assesses mail stored before assessment existed, or missed when it arrived. */
export async function assessPending({ now = Date.now(), limit = BACKLOG_BATCH } = {}) {
  if (!env.AUTO_REPLY_ENABLED || !isConnected()) return { suggested: 0, notEligible: 0 };
  const pending = await MailboxMessage.find({ source: { $in: SOURCES }, autoReply: null, purgedAt: null, removedAt: null })
    .select('mailboxMessageId')
    .limit(limit)
    .lean();
  return assess(
    pending.map((row) => row.mailboxMessageId),
    { now },
  );
}
