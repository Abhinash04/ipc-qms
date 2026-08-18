import { isConnected } from '../../../config/db.js';
import env, { MAILBOX_SOURCES } from '../../../config/env.js';
import * as memoryMailbox from './mockIpcMailbox.js';
import * as mongoMailbox from './mongoIpcMailbox.js';
import * as gmailInbox from './gmailInboxReader.js';

let forced = null;

function forceInMemory() {
  forced = memoryMailbox;
}

function useAuto() {
  forced = null;
}

/**
 * Read at call time rather than from the snapshot taken at import, matching
 * `config/identities.js`. Tests vary the environment between cases, and the
 * setting is a deployment choice rather than something cached for speed.
 */
const mailboxSource = () =>
  (process.env.MAILBOX_SOURCE || env.MAILBOX_SOURCE || MAILBOX_SOURCES.AUTO).toLowerCase();

function active() {
  if (forced) return forced;
  if (mailboxSource() === MAILBOX_SOURCES.GMAIL) return gmailInbox;
  return isConnected() ? mongoMailbox : memoryMailbox;
}

function describe() {
  const impl = active();

  if (impl === gmailInbox) {
    return {
      backend: 'gmail',
      persistence: "the Front Officer's real Gmail inbox; unread mail is what is pending",
    };
  }

  const isMongo = impl === mongoMailbox;
  return {
    backend: isMongo ? 'mongo' : 'in-memory',
    persistence: isMongo
      ? 'MongoDB; survives backend restart'
      : 'in-memory; cleared on backend restart',
  };
}

/**
 * Can the active store accept a locally-deposited copy of an outgoing message?
 *
 * The in-memory and Mongo stores can. A real Gmail inbox cannot — it is read
 * only, and mail arrives in it by actually being sent. Callers must check this
 * before depositing rather than discovering it through a thrown error.
 */
const supportsDelivery = () => active() !== gmailInbox;

const deliver = async (message) => active().deliver(message);
const list = async (recipient, options) => active().list(recipient, options);
const markIngested = async (recipient, id) => active().markIngested(recipient, id);
const reset = async () => active().reset();
const stats = async () => active().stats();

export {
  deliver,
  list,
  markIngested,
  reset,
  stats,
  describe,
  supportsDelivery,
  forceInMemory,
  useAuto,
};
