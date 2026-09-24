import * as mailbox from '../mailbox/index.js';
import { DELIVERY, labelDelivery } from '../delivery.js';

let sendCounter = 0;
const sentMessages = [];

async function send(message, options = {}) {
  try {
    return await sendToMailbox(message, options);
  } catch (error) {
    throw labelDelivery(error, DELIVERY.NOT_SENT);
  }
}

async function sendToMailbox(message, { asRole = null } = {}) {
  sendCounter += 1;
  const providerMessageId = `mock-msg-${sendCounter}`;
  const providerThreadId = message.providerThreadId || `mock-thread-${sendCounter}`;

  const record = { ...message, providerMessageId, providerThreadId, transport: 'mock', sentAsRole: asRole };
  sentMessages.push(record);

  if (mailbox.supportsDelivery()) {
    const primaryRecipient = Array.isArray(message.to) ? message.to[0] : message.to;
    await mailbox.deliver({
      to: primaryRecipient,
      from: message.from,
      cc: message.cc || [],
      bcc: message.bcc || [],
      subject: message.subject,
      body: message.body,
      attachments: (message.attachments || []).map(
        ({ attachmentId, filename, mimeType, size }) => ({ attachmentId, filename, mimeType, size }),
      ),
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
  if (mailbox.supportsDelivery()) await mailbox.reset();
}

export const name = 'mock';
export { send, listSent, reset };
