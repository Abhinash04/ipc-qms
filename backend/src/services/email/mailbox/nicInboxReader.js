import crypto from 'crypto';
import nicConfig from '../../../config/nicConfig.js';
import { readMessages } from '../nic/nicImap.js';
import { normaliseAddress } from './address.js';

function stableId(message) {
  const basis = message.messageId || `${nicConfig.mailbox}:${message.uid}`;
  return `NIC-${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16)}`;
}

function toMailboxMessage(message) {
  return {
    mailboxMessageId: stableId(message),
    to: normaliseAddress(message.toAddresses?.[0] || nicConfig.email),
    from: message.from || '',
    cc: message.cc ? [message.cc] : [],
    bcc: [],
    subject: message.subject || '(no subject)',
    body: message.text || '',
    attachments: (message.attachments || []).map((att) => ({
      filename: att.filename,
      mimeType: att.contentType,
      size: att.size,
    })),
    receivedAt: message.date || new Date().toISOString(),
    ingested: false,
  };
}

const readOnly = (operation) => {
  throw new Error(
    `The NICeMail mailbox is read-only — ${operation} is not available. ` +
      'Mail arrives in it by genuinely being sent.',
  );
};

async function list(recipient, { max = 20 } = {}) {
  const result = await readMessages({ limit: max });

  if (!result.ok) {
    throw Object.assign(new Error(`NICeMail read failed at ${result.stage}: ${result.error}`), {
      stage: result.stage,
    });
  }

  const wanted = normaliseAddress(recipient);
  return result.data.messages
    .map(toMailboxMessage)
    .filter((message) => !wanted || message.to === wanted);
}

async function stats() {
  const result = await readMessages({ limit: 1 });
  if (!result.ok) return { recipients: 0, messages: 0 };
  return { recipients: 1, messages: result.data.total };
}

const deliver = async () => readOnly('depositing a message');
const reset = async () => readOnly('clearing the mailbox');
const remove = async () => readOnly('deleting a message');

const markIngested = async () => null;

export const backend = 'nic';
export { deliver, list, markIngested, remove, reset, stats };
