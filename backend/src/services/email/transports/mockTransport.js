import * as mailbox from '../mailbox/index.js';

let sendCounter = 0;
const sentMessages = [];

async function send(message, { asRole = null } = {}) {
  sendCounter += 1;
  const providerMessageId = `mock-msg-${sendCounter}`;
  const providerThreadId = message.providerThreadId || `mock-thread-${sendCounter}`;

  const record = { ...message, providerMessageId, providerThreadId, transport: 'mock', sentAsRole: asRole };
  sentMessages.push(record);

  // Deposit a copy into the mock IPC inbox so the enquiry → ingestion loop
  // closes locally. Skipped when the mailbox is a real Gmail inbox: that store
  // is read-only and mail arrives in it by genuinely being sent, so there is
  // nothing to deposit into. Attempting it threw, and surfaced as a 500 on
  // every send made through this transport.
  if (mailbox.supportsDelivery()) {
    // Only the *primary* recipient is delivered — cc/bcc are carried on the
    // record but are not separate inboxes in this development stand-in.
    const primaryRecipient = Array.isArray(message.to) ? message.to[0] : message.to;
    await mailbox.deliver({
      to: primaryRecipient,
      from: message.from,
      cc: message.cc || [],
      bcc: message.bcc || [],
      subject: message.subject,
      body: message.body,
      attachments: message.attachments || [],
      receivedAt: message.timestamp,
    });
  }

  return { providerMessageId, providerThreadId, transport: 'mock', sentAsRole: asRole };
}

function listSent() {
  return [...sentMessages];
}

async function reset() {
  sendCounter = 0;
  sentMessages.length = 0;
  // Same reason as the deposit above: a real inbox cannot be cleared, and
  // trying would delete somebody's mail.
  if (mailbox.supportsDelivery()) await mailbox.reset();
}

export const name = 'mock';
export { send, listSent, reset };
