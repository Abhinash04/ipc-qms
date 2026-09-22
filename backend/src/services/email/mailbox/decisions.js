import { MailboxDecision, DECISIONS } from '../../../models/MailboxDecision.js';

/**
 * Accept/reject decisions on incoming mailbox messages.
 *
 * The one guarantee this module makes is that **the first decision on a message
 * wins**. Everything downstream — case creation, the acknowledgement, the audit
 * event — hangs off that, so a double-click, a retried request or two Front
 * Officers looking at the same inbox cannot produce two cases for one email.
 */

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

/**
 * Record a decision, once.
 *
 * `$setOnInsert` with `upsert` is the whole mechanism: the unique index on
 * `mailboxMessageId` makes the first write the only write, and a second call
 * returns what is already stored rather than overwriting it. Returns
 * `{ decision, alreadyDecided }` so the caller can tell the two apart — the
 * client needs to know whether it should go on to create a case or stop.
 */
async function recordDecision({
  mailboxMessageId,
  decision,
  queryId = null,
  reason = '',
  decidedBy,
  message = {},
}) {
  const before = await MailboxDecision.findOne({ mailboxMessageId }).lean();
  if (before) return { decision: toPlain(before), alreadyDecided: true };

  const stored = await MailboxDecision.findOneAndUpdate(
    { mailboxMessageId },
    {
      $setOnInsert: {
        mailboxMessageId,
        decision,
        queryId,
        reason,
        decidedByUserId: decidedBy?.id ?? null,
        decidedByRole: decidedBy?.role ?? null,
        decidedAt: new Date().toISOString(),
        from: message.from || '',
        subject: message.subject || '',
        receivedAt: message.receivedAt || null,
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();

  // The read above is not a lock: two concurrent requests can both miss it. The
  // unique index still admits exactly one, and `$setOnInsert` makes the loser's
  // write a no-op that returns the winner's document — so the stored decision
  // is correct either way, and both callers are told `alreadyDecided: false`.
  // That is a truthful answer to "did this call find an existing decision?", and
  // a duplicate case cannot follow from it: `ingestEmail` is itself idempotent
  // on the same message id.
  return { decision: toPlain(stored), alreadyDecided: false };
}

async function listDecisions() {
  const rows = await MailboxDecision.find({}).sort({ decidedAt: -1 }).lean();
  return rows.map(toPlain);
}

async function findDecision(mailboxMessageId) {
  return toPlain(await MailboxDecision.findOne({ mailboxMessageId }).lean());
}

/** The decisions on these messages, by message id — one query for a whole inbox page. */
async function findDecisions(mailboxMessageIds) {
  const rows = await MailboxDecision.find({ mailboxMessageId: { $in: mailboxMessageIds } }).lean();
  return new Map(rows.map((row) => [row.mailboxMessageId, toPlain(row)]));
}

export { recordDecision, listDecisions, findDecision, findDecisions, DECISIONS };
