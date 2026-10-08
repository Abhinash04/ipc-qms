import { MailboxMessage, Counter } from '../../../models/MailboxMessage.js';
import { normaliseAddress } from './address.js';
const COUNTER_KEY = 'mailboxMessage';

const NOT_NICEMAIL = { source: { $ne: 'nic-browser' } };
const mine = (recipient) => ({ to: normaliseAddress(recipient), ...NOT_NICEMAIL });
const pad = (n) => String(n).padStart(5, '0');

async function nextMessageId() {
  const counter = await Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { value: 1 } },
    { returnDocument: 'after', upsert: true },
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
    createdAt: new Date().toISOString(),
  });

  return toPlain(doc);
}

async function list(recipient, { unreadOnly = false } = {}) {
  const filter = mine(recipient);
  if (unreadOnly) filter.ingested = false;
  const docs = await MailboxMessage.find(filter).sort({ mailboxMessageId: 1 });
  return docs.map(toPlain);
}

async function markIngested(recipient, mailboxMessageId) {
  const doc = await MailboxMessage.findOneAndUpdate(
    { ...mine(recipient), mailboxMessageId },
    { ingested: true },
    { returnDocument: 'after' },
  );
  return toPlain(doc);
}

async function remove(recipient, mailboxMessageId) {
  const doc = await MailboxMessage.findOneAndDelete({ ...mine(recipient), mailboxMessageId });
  return toPlain(doc);
}

async function reset() {
  await Promise.all([
    MailboxMessage.deleteMany(NOT_NICEMAIL),
    Counter.deleteOne({ key: COUNTER_KEY }),
  ]);
}

async function stats() {
  const messages = await MailboxMessage.countDocuments(NOT_NICEMAIL);
  const recipients = (await MailboxMessage.distinct('to', NOT_NICEMAIL)).length;
  return { recipients, messages };
}

export const backend = 'mongo';
export { deliver, list, markIngested, remove, reset, stats };
