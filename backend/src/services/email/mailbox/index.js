import { isConnected } from '../../../config/db.js';
import env, { MAILBOX_SOURCES } from '../../../config/env.js';
import * as memoryMailbox from './mockIpcMailbox.js';
import * as mongoMailbox from './mongoIpcMailbox.js';
import * as nicInbox from './nicInboxReader.js';
import browserConfig from '../../../config/browserConfig.js';
import { normaliseAddress } from './address.js';

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
  if (mailboxSource() === MAILBOX_SOURCES.NIC) return nicInbox;
  return isConnected() ? mongoMailbox : memoryMailbox;
}

function describe() {
  const impl = active();

  if (impl === nicInbox) {
    return {
      backend: 'nic',
      persistence: 'the NICeMail mailbox over IMAP, read-only; mail arrives by being sent',
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
 * The in-memory and Mongo stores can. A NICeMail IMAP inbox cannot — it is read
 * only, and mail arrives in it by actually being sent. Callers must check this
 * before depositing rather than discovering it through a thrown error.
 */
const supportsDelivery = () => active() !== nicInbox;

const deliver = async (message) => active().deliver(message);

const list = async (recipient, options) => active().list(recipient, options);

/**
 * One message by id. A store with no lookup of its own is listed and searched
 * — both of its lists, because an older unread message shows in the "awaiting"
 * list but not in the full one.
 */
const get = async (recipient, id) => {
  const impl = active();
  if (typeof impl.get === 'function') return impl.get(recipient, id);
  for (const unreadOnly of [true, false]) {
    const found = (await list(recipient, { unreadOnly })).find((message) => message.mailboxMessageId === id);
    if (found) return found;
  }
  return null;
};

const markIngested = async (recipient, id) => active().markIngested(recipient, id);

const remove = async (recipient, id) => active().remove(recipient, id);

const reset = async () => active().reset();

const stats = async () => active().stats();

/**
 * The mailbox a signed-in user owns, when it is not the primary one.
 *
 * There are at most two Front Office mailboxes: the primary one, selected by
 * MAILBOX_SOURCE exactly as before, and — when NIC_BROWSER_MAILBOX=true — the
 * NICeMail mailbox read by the browser agent, owned by the Front Office user
 * whose sign-in address is NIC_EMAIL. Routing is by the mailbox, never by the
 * sender: whatever arrives in the NICeMail mailbox is that user's to handle.
 *
 * Resolves to `{ source, address, store }` for the NICeMail mailbox, or null
 * to mean "the primary mailbox".
 *
 * The store is imported on demand: it reaches the browser agent through the
 * reader, and nothing on the boot path may load that — a backend without
 * Chrome must start exactly as before.
 */
async function forUser(user) {
  if (!browserConfig.mailboxEnabled || !browserConfig.mailboxAddress) return null;
  if (normaliseAddress(user?.email) !== browserConfig.mailboxAddress) return null;
  const store = await import('./nicBrowserMailbox.js');
  return { source: store.SOURCE, address: browserConfig.mailboxAddress, store };
}

export {
  deliver,
  list,
  get,
  markIngested,
  remove,
  reset,
  stats,
  describe,
  supportsDelivery,
  forceInMemory,
  useAuto,
  forUser,
};
