import { MailboxMessage } from '../../models/MailboxMessage.js';
import { QueryCase, ResponseVersion } from '../../models/index.js';
import * as audit from '../audit/auditService.js';
import { change } from '../audit/caseChanges.js';
import * as caseMail from '../email/caseMail.js';
import { OUTCOMES } from '../email/outbox.js';
import { AUDIT_ACTIONS } from '../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUTO_REPLY_BUCKET, AUTO_REPLY_STATUS } from './assess.js';

/**
 * The automatic reply to a mail the Front Office accepted. Accepting a mail that was offered one
 * registers the case, summarises and acknowledges it as usual, and then, instead of forwarding it
 * to the Officer-in-Charge, sends the reply drafted from the matched supported question through
 * the case's normal dispatch, which closes the case. Sending is idempotent: a retry or a repeat
 * Accept never sends twice.
 */

const S = AUTO_REPLY_STATUS;
const SENT = new Set([OUTCOMES.SENT, OUTCOMES.ALREADY_SENT]);

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const now = () => new Date().toISOString();

const human = (actor) => ({ actorType: ACTOR_TYPES.HUMAN, actorId: actor?.id ?? null, actorRole: actor?.role ?? null });

const setStatus = (mailboxMessageId, fields) =>
  MailboxMessage.updateOne(
    { mailboxMessageId },
    { $set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`autoReply.${key}`, value])) },
  );

const current = async (mailboxMessageId) =>
  (await MailboxMessage.findOne({ mailboxMessageId }).select('autoReply').lean())?.autoReply ?? null;

async function refuseUnclaimed(mailboxMessageId) {
  const autoReply = await current(mailboxMessageId);
  if (autoReply?.status === S.SENT) {
    return { queryId: autoReply.queryId, sent: true, alreadySent: true, outcome: OUTCOMES.ALREADY_SENT, error: null, autoReply };
  }
  if (autoReply?.status === S.APPROVING) throw conflict('This automatic reply is already being sent.');
  throw conflict('This mail has no automatic reply to send.');
}

/** The reply as the case's approved response, and the case ready to send it; done once. */
async function prepareReply({ queryId, mailboxMessageId, suggestion, actor }) {
  const at = now();
  await ResponseVersion.updateOne(
    { responseId: `RESP-${queryId}-AUTO` },
    {
      $setOnInsert: {
        responseId: `RESP-${queryId}-AUTO`,
        queryId,
        version: 'v1',
        label: 'Automatic reply',
        content: suggestion.draft,
        createdBy: null,
        source: 'AUTO_REPLY',
        aiGenerated: true,
        status: 'FINAL_APPROVED',
        approvedAt: at,
        createdAt: at,
      },
    },
    { upsert: true },
  );

  const moved = await QueryCase.updateOne(
    { queryId, workflowState: 'FRONT_OFFICE_VERIFICATION' },
    { $set: { workflowState: 'READY_FOR_DISPATCH', updatedAt: at }, $inc: { revision: 1 } },
  );
  if (!moved?.modifiedCount) return;

  // The AI prepares the reply, on behalf of the Front Officer whose Accept set it going.
  await audit.record({
    action: AUDIT_ACTIONS.AUTO_REPLY_PREPARED,
    actorType: ACTOR_TYPES.AGENT,
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    queryId,
    messageId: mailboxMessageId,
    changes: change('status', 'FRONT_OFFICE_VERIFICATION', 'READY_FOR_DISPATCH'),
    details: {
      entryId: suggestion.entryId,
      topic: suggestion.topic ?? null,
      confidence: suggestion.confidence,
      threshold: suggestion.threshold ?? null,
    },
  });
}

/**
 * Sends the automatic reply for an accepted mail whose case is `queryId`: claims it, prepares the
 * reply once, and dispatches it. A failed send stays FAILED for a retry; it never goes to the OIC.
 */
export async function sendAutoReply({ queryId, mailboxMessageId, actor }) {
  const claimed = await MailboxMessage.findOneAndUpdate(
    { mailboxMessageId, 'autoReply.status': { $in: [S.SUGGESTED, S.FAILED] } },
    { $set: { 'autoReply.status': S.APPROVING, 'autoReply.error': null, 'autoReply.queryId': queryId } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) return refuseUnclaimed(mailboxMessageId);

  try {
    await prepareReply({ queryId, mailboxMessageId, suggestion: claimed.autoReply, actor });

    const result = await caseMail.dispatchResponse({ queryId, actor });
    const sent = SENT.has(result.outcome);
    const error = sent ? null : result.error || 'The automatic reply could not be sent.';
    await setStatus(mailboxMessageId, sent ? { status: S.SENT, sentAt: now(), error: null } : { status: S.FAILED, error });

    return {
      queryId,
      sent,
      alreadySent: result.outcome === OUTCOMES.ALREADY_SENT,
      outcome: result.outcome,
      error,
      autoReply: await current(mailboxMessageId),
    };
  } catch (error) {
    await setStatus(mailboxMessageId, { status: S.FAILED, error: error.message });
    throw error;
  }
}

/** Sends again an automatic reply whose send failed. */
export async function retryAutoReply({ mailboxMessageId, actor }) {
  const autoReply = await current(mailboxMessageId);
  if (autoReply?.status !== S.FAILED || !autoReply.queryId) {
    throw conflict('Only an automatic reply that could not be sent can be retried.');
  }
  return sendAutoReply({ queryId: autoReply.queryId, mailboxMessageId, actor });
}

// A suggestion not yet acted on, or whose send failed before any case was made.
const UNTOUCHED = { $or: [{ 'autoReply.status': S.SUGGESTED }, { 'autoReply.status': S.FAILED, 'autoReply.queryId': null }] };

/** The FO sends a suggested mail to Human Intervention instead. */
export async function declineAutoReply({ mailboxMessageId, reason = '', actor }) {
  const declined = await MailboxMessage.findOneAndUpdate(
    { mailboxMessageId, ...UNTOUCHED },
    {
      $set: {
        'autoReply.status': S.DECLINED,
        'autoReply.reason': reason || 'sent to Human Intervention by the Front Office',
        'autoReply.declinedAt': now(),
        'autoReply.declinedByUserId': actor?.id ?? null,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!declined) throw conflict('This mail has no automatic reply waiting to be sent.');

  await audit.record({
    action: AUDIT_ACTIONS.AUTO_REPLY_DECLINED,
    ...human(actor),
    messageId: mailboxMessageId,
    details: { entryId: declined.autoReply.entryId, topic: declined.autoReply.topic ?? null, reason: declined.autoReply.reason },
  });
  return declined.autoReply;
}

/**
 * Before a mail is rejected: a suggested reply is withdrawn, and a mail whose automatic reply is
 * being sent or was sent is refused.
 */
export async function releaseForRejection({ mailboxMessageId, actor }) {
  const autoReply = await current(mailboxMessageId);
  if (!autoReply || !AUTO_REPLY_BUCKET.includes(autoReply.status)) return;
  if (autoReply.status !== S.SUGGESTED && !(autoReply.status === S.FAILED && !autoReply.queryId)) {
    throw conflict('This mail is being answered by an automatic reply; it cannot be rejected.');
  }
  await declineAutoReply({ mailboxMessageId, reason: 'rejected by the Front Office', actor });
}
