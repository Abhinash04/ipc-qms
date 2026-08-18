/**
 * Mock email transport — the development default.
 *
 * Performs NO network I/O. It records the send and hands the message to the
 * mock IPC mailbox when the recipient is the configured IPC address, so the
 * enquiry → ingestion loop closes entirely locally.
 *
 * Deterministic: provider message IDs are sequential (`mock-msg-1`, …) and
 * `reset()` returns the counter to zero, so tests can assert exact values.
 */

import * as mailbox from '../mailbox/index.js';

let sendCounter = 0;
const sentMessages = [];

async function send(message) {
  sendCounter += 1;
  const providerMessageId = `mock-msg-${sendCounter}`;
  const providerThreadId = message.providerThreadId || `mock-thread-${sendCounter}`;

  const record = { ...message, providerMessageId, providerThreadId, transport: 'mock' };
  sentMessages.push(record);

  // Deliver into the mock IPC inbox so ingestion has something to find.
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

  return { providerMessageId, providerThreadId, transport: 'mock' };
}

/** Everything sent this process lifetime — used by tests and the dev UI. */
function listSent() {
  return [...sentMessages];
}

async function reset() {
  sendCounter = 0;
  sentMessages.length = 0;
  await mailbox.reset();
}

export const name = 'mock';
export { send, listSent, reset };
