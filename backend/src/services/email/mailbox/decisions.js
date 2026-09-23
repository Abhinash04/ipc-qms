import { MailboxDecision, DECISIONS } from '../../../models/MailboxDecision.js';

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

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

  return { decision: toPlain(stored), alreadyDecided: false };
}

async function listDecisions() {
  const rows = await MailboxDecision.find({}).sort({ decidedAt: -1 }).lean();
  return rows.map(toPlain);
}

async function findDecision(mailboxMessageId) {
  return toPlain(await MailboxDecision.findOne({ mailboxMessageId }).lean());
}

async function findDecisions(mailboxMessageIds) {
  const rows = await MailboxDecision.find({ mailboxMessageId: { $in: mailboxMessageIds } }).lean();
  return new Map(rows.map((row) => [row.mailboxMessageId, toPlain(row)]));
}

export { recordDecision, listDecisions, findDecision, findDecisions, DECISIONS };
