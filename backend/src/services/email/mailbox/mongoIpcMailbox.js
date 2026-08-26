import { MailboxMessage, Counter } from '../../../models/MailboxMessage.js';
import { normaliseAddress } from './address.js';
const COUNTER_KEY = 'mailboxMessage';
const pad = (n) => String(n).padStart(5, '0');

async function nextMessageId() {
  const counter = await Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  );
  return `MSG-${pad(counter.value)}`;
}

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

async function deliver({ to, from, subject, body, attachments = [], cc = [], bcc = [], receivedAt }) {
  if (!to) throw new Error('mongoIpcMailbox.deliver: "to" is required');
  if (!from) throw new Error('mongoIpcMailbox.deliver: "from" is required');

  const doc = await MailboxMessage.create({
    mailboxMessageId: await nextMessageId(),
    to: normaliseAddress(to),
    from,
    cc,
    bcc,
    subject: subject || '(no subject)',
    body: body || '',
    attachments,
    receivedAt: receivedAt || new Date().toISOString(),
    ingested: false,
  });

  return toPlain(doc);
}

async function list(recipient, { unreadOnly = false } = {}) {
  const filter = { to: normaliseAddress(recipient) };
  if (unreadOnly) filter.ingested = false;
  const docs = await MailboxMessage.find(filter).sort({ mailboxMessageId: 1 });
  return docs.map(toPlain);
}

async function markIngested(recipient, mailboxMessageId) {
  const doc = await MailboxMessage.findOneAndUpdate(
    { to: normaliseAddress(recipient), mailboxMessageId },
    { ingested: true },
    { new: true },
  );
  return toPlain(doc);
}

async function remove(recipient, mailboxMessageId) {
  // The Counter doc is deliberately left alone: ids stay monotonic so a deleted
  // message's id is never handed to a later one.
  const doc = await MailboxMessage.findOneAndDelete({
    to: normaliseAddress(recipient),
    mailboxMessageId,
  });
  return toPlain(doc);
}

async function reset() {
  await Promise.all([
    MailboxMessage.deleteMany({}),
    Counter.deleteOne({ key: COUNTER_KEY }),
  ]);
}

async function stats() {
  const messages = await MailboxMessage.countDocuments();
  const recipients = (await MailboxMessage.distinct('to')).length;
  return { recipients, messages };
}

export const backend = 'mongo';
export { deliver, list, markIngested, remove, reset, stats };
