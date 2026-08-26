import { normaliseAddress } from './address.js';

const pad = (n) => String(n).padStart(5, '0');
const inboxes = new Map();
let messageCounter = 0;

function deliver({ to, from, subject, body, attachments = [], cc = [], bcc = [], receivedAt }) {
  if (!to) throw new Error('mockIpcMailbox.deliver: "to" is required');
  if (!from) throw new Error('mockIpcMailbox.deliver: "from" is required');

  messageCounter += 1;
  const message = {
    mailboxMessageId: `MSG-${pad(messageCounter)}`,
    to,
    from,
    cc,
    bcc,
    subject: subject || '(no subject)',
    body: body || '',
    attachments,
    receivedAt: receivedAt || new Date().toISOString(),
    ingested: false,
  };

  const key = normaliseAddress(to);
  if (!inboxes.has(key)) inboxes.set(key, []);
  inboxes.get(key).push(message);
  return message;
}

function list(recipient, { unreadOnly = false } = {}) {
  const messages = inboxes.get(normaliseAddress(recipient)) || [];
  return unreadOnly ? messages.filter((m) => !m.ingested) : [...messages];
}

function markIngested(recipient, mailboxMessageId) {
  const message = (inboxes.get(normaliseAddress(recipient)) || []).find(
    (m) => m.mailboxMessageId === mailboxMessageId,
  );
  if (!message) return null;
  message.ingested = true;
  return message;
}

function remove(recipient, mailboxMessageId) {
  const messages = inboxes.get(normaliseAddress(recipient));
  if (!messages) return null;

  const index = messages.findIndex((m) => m.mailboxMessageId === mailboxMessageId);
  if (index === -1) return null;

  // The counter is deliberately left alone: ids stay monotonic so a deleted
  // message's id is never handed to a later one.
  const [removed] = messages.splice(index, 1);
  return removed;
}

function reset() {
  inboxes.clear();
  messageCounter = 0;
}

function stats() {
  let total = 0;
  for (const messages of inboxes.values()) total += messages.length;
  return { recipients: inboxes.size, messages: total };
}

export { deliver, list, markIngested, remove, reset, stats };
