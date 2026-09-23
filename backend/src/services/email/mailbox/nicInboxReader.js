import crypto from 'crypto';
import nicConfig from '../../../config/nicConfig.js';
import { readMessages } from '../nic/nicImap.js';
import { normaliseAddress } from './address.js';

/**
 * The NICeMail mailbox as a QMS mailbox provider, read over IMAP.
 *
 * Read-only, because this is somebody's real mailbox: `nicImap` opens the
 * folder with `readOnly: true`, so this cannot
 * even set `\Seen`, let alone move or delete. `deliver` and `reset` therefore
 * throw rather than silently doing nothing — `mailbox/index.js` exposes
 * `supportsDelivery()` so callers check before depositing.
 *
 * Not to be confused with the browser agent, which reads the same mailbox
 * through an authenticated web session over CDP and shares no code with this.
 */

/**
 * Ids must survive re-polling: the same message read twice has to produce the
 * same id, or every sweep re-ingests the whole folder. IMAP UIDs are stable
 * within a folder but reset on UIDVALIDITY change, so the Message-ID header is
 * preferred and the UID is only the fallback. Derived the same way the browser
 * agent's reader derives its ids (nic/browser/readInbox.js), so both mailboxes
 * behave the same way across a re-poll.
 */
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
    // Metadata only — nicImap does not download attachment bytes. The bytes are
    // fetched later, by id, exactly as the browser agent's reader does it.
    attachments: (message.attachments || []).map((att) => ({
      filename: att.filename,
      mimeType: att.contentType,
      size: att.size,
    })),
    receivedAt: message.date || new Date().toISOString(),
    // IMAP `\Seen` is not read here: the folder is opened read-only, so the
    // flag could never be set back and would misreport every message as new.
    // Ingestion state lives in the QMS, not in the mailbox.
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

/**
 * A no-op that reports what happened rather than pretending.
 *
 * Marking a message ingested is QMS state. There is nothing to write back to a
 * read-only folder, and returning null lets the caller tell that apart from a
 * store that really did record it.
 */
const markIngested = async () => null;

export const backend = 'nic';
export { deliver, list, markIngested, remove, reset, stats };
