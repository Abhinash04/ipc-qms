import { MailboxMessage } from '../../models/MailboxMessage.js';
import { QueryCase, ResponseVersion } from '../../models/index.js';
import * as audit from '../audit/auditService.js';
import { change } from '../audit/caseChanges.js';
import * as caseMail from '../email/caseMail.js';
import { OUTCOMES } from '../email/outbox.js';
import { registerCase } from '../email/mailbox/acceptMessage.js';
import * as decisions from '../email/mailbox/decisions.js';
import { AUDIT_ACTIONS } from '../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUTO_REPLY_BUCKET, AUTO_REPLY_STATUS } from './assess.js';

/**
 * The Front Office's decision on a suggested automatic reply. Approving is the only way an
 * automatic reply is ever sent: it registers the mail as a Query Case, records the FO's text as
 * the approved response, and sends it through the case's normal dispatch, which closes the case.
 * No acknowledgement and no forward to the Officer-in-Charge are sent.
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

async function refuseUnclaimed(mailboxMessageId) {
  const current = (await MailboxMessage.findOne({ mailboxMessageId }).select('autoReply').lean())?.autoReply;
  if (current?.status === S.SENT) {
    return { queryId: current.queryId, sent: true, alreadySent: true, outcome: OUTCOMES.ALREADY_SENT, autoReply: current };
  }
  if (current?.status === S.APPROVING) throw conflict('This automatic reply is already being sent.');
  throw conflict('This mail has no automatic reply waiting for approval.');
}

/** Registers the case and records the approved reply, once; a retry finds them already made. */
async function prepareCase({ mailboxMessageId, message, body, actor, sourceMailbox, suggestion }) {
  const { queryId, created } = await registerCase({
    mailboxMessageId,
    message,
    actor,
    sourceMailbox,
    caseFields: { autoReply: { entryId: suggestion.entryId, topic: suggestion.topic ?? null, confidence: suggestion.confidence } },
  });
  if (!created) {
    // The mail became a case some other way (the standard workflow got there first).
    await setStatus(mailboxMessageId, { status: S.DECLINED, reason: 'handled through the standard workflow' });
    throw conflict(`This mail is already Query Case ${queryId}, handled through the standard workflow.`);
  }
  await setStatus(mailboxMessageId, { queryId });

  const at = now();
  await ResponseVersion.create({
    responseId: `RESP-${queryId}-AUTO`,
    queryId,
    version: 'v1',
    label: 'Automatic reply',
    content: body,
    createdBy: actor?.id ?? null,
    source: 'AUTO_REPLY',
    aiGenerated: false,
    status: 'FINAL_APPROVED',
    approvedAt: at,
    createdAt: at,
  });
  await QueryCase.updateOne(
    { queryId, workflowState: 'FRONT_OFFICE_VERIFICATION' },
    { $set: { workflowState: 'READY_FOR_DISPATCH', updatedAt: at }, $inc: { revision: 1 } },
  );
  await audit.record({
    action: AUDIT_ACTIONS.AUTO_REPLY_APPROVED,
    ...human(actor),
    queryId,
    messageId: mailboxMessageId,
    changes: change('status', 'FRONT_OFFICE_VERIFICATION', 'READY_FOR_DISPATCH'),
    details: {
      entryId: suggestion.entryId,
      topic: suggestion.topic ?? null,
      confidence: suggestion.confidence,
      edited: body.trim() !== String(suggestion.draft || '').trim(),
    },
  });
  await decisions.recordDecision({
    mailboxMessageId,
    decision: 'ACCEPTED',
    queryId,
    decidedBy: { id: actor?.id ?? null, role: actor?.role ?? null },
    message: { from: message.from, subject: message.subject, receivedAt: message.receivedAt },
  });
  return queryId;
}

export async function approveAutoReply({ mailboxMessageId, message, body, actor, sourceMailbox = null }) {
  const claimed = await MailboxMessage.findOneAndUpdate(
    { mailboxMessageId, 'autoReply.status': { $in: [S.SUGGESTED, S.FAILED] } },
    { $set: { 'autoReply.status': S.APPROVING, 'autoReply.error': null } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) return refuseUnclaimed(mailboxMessageId);

  const suggestion = claimed.autoReply;
  try {
    let { queryId } = suggestion;
    if (!queryId) {
      if (await decisions.findDecision(mailboxMessageId)) {
        await setStatus(mailboxMessageId, { status: S.DECLINED, reason: 'handled through the standard workflow' });
        throw conflict('This mail was already accepted or rejected through the standard workflow.');
      }
      queryId = await prepareCase({ mailboxMessageId, message, body, actor, sourceMailbox, suggestion });
      await setStatus(mailboxMessageId, { approvedBody: body, approvedAt: now(), approvedByUserId: actor?.id ?? null });
    }

    const result = await caseMail.dispatchResponse({ queryId, actor });
    const sent = SENT.has(result.outcome);
    const error = sent ? null : result.error || 'The automatic reply could not be sent.';
    await setStatus(mailboxMessageId, sent ? { status: S.SENT, sentAt: now() } : { status: S.FAILED, error });

    const autoReply = (await MailboxMessage.findOne({ mailboxMessageId }).select('autoReply').lean())?.autoReply ?? null;
    return { queryId, sent, alreadySent: result.outcome === OUTCOMES.ALREADY_SENT, outcome: result.outcome, error, autoReply };
  } catch (error) {
    if (error.status !== 409) await setStatus(mailboxMessageId, { status: S.FAILED, error: error.message });
    throw error;
  }
}

// A suggestion not yet acted on, or whose approval failed before any case was made.
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
  if (!declined) throw conflict('This mail has no automatic reply waiting for approval.');

  await audit.record({
    action: AUDIT_ACTIONS.AUTO_REPLY_DECLINED,
    ...human(actor),
    messageId: mailboxMessageId,
    details: { entryId: declined.autoReply.entryId, topic: declined.autoReply.topic ?? null, reason: declined.autoReply.reason },
  });
  return declined.autoReply;
}

/**
 * Before a mail is accepted or rejected through the standard workflow: a suggested reply is
 * withdrawn, and a mail whose automatic reply is being sent or was sent is refused.
 */
export async function releaseForStandardWorkflow({ mailboxMessageId, actor }) {
  const current = (await MailboxMessage.findOne({ mailboxMessageId }).select('autoReply').lean())?.autoReply;
  if (!current || !AUTO_REPLY_BUCKET.includes(current.status)) return;
  if (current.status !== S.SUGGESTED && !(current.status === S.FAILED && !current.queryId)) {
    throw conflict('This mail is being answered by an automatic reply; it cannot also go through the standard workflow.');
  }
  await declineAutoReply({ mailboxMessageId, reason: 'handled through the standard workflow', actor });
}
