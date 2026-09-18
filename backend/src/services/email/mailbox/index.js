import { isConnected } from '../../../config/db.js';
import env, { MAILBOX_SOURCES } from '../../../config/env.js';
import * as memoryMailbox from './mockIpcMailbox.js';
import * as mongoMailbox from './mongoIpcMailbox.js';
import * as gmailInbox from './gmailInboxReader.js';
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
  const source = mailboxSource();
  if (source === MAILBOX_SOURCES.GMAIL) return gmailInbox;
  if (source === MAILBOX_SOURCES.NIC) return nicInbox;
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
 * The in-memory and Mongo stores can. A real Gmail or NICeMail inbox cannot —
 * both are read only, and mail arrives in them by actually being sent. Callers
 * must check this before depositing rather than discovering it through a thrown
 * error.
 */
const supportsDelivery = () => {
  const impl = active();
  return impl !== gmailInbox && impl !== nicInbox;
};

/**
 * Short-lived cache for Gmail list() only.
 *
 * A Gmail list is one upstream search plus one fetch per message, so it is by
 * far the slowest read in the API. The cache is keyed by recipient AND filter
 * (never one global entry — different recipients see different mailboxes), it
 * stores the in-flight promise so concurrent identical requests coalesce into
 * one upstream call, and every mailbox mutation clears it so a just-ingested
 * or deleted message can never be served back. The mock and Mongo stores are
 * local and cheap, and tests depend on their read-after-write behaviour, so
 * they are never cached.
 */
const GMAIL_LIST_TTL_MS = 30_000;
const gmailListCache = new Map();

const invalidateListCache = () => gmailListCache.clear();

const deliver = async (message) => {
  invalidateListCache();
  return active().deliver(message);
};

const list = async (recipient, options) => {
  const impl = active();
  // options.client is the test seam; a caller providing its own client must
  // hit that client, not a cache shared with production reads.
  if (impl !== gmailInbox || options?.client) return impl.list(recipient, options);

  const key = `${String(recipient || '').toLowerCase()}|${Boolean(options?.unreadOnly)}|${options?.max ?? ''}`;
  const hit = gmailListCache.get(key);
  if (hit && Date.now() - hit.at < GMAIL_LIST_TTL_MS) return hit.promise;

  const promise = impl.list(recipient, options).catch((error) => {
    // A failed fetch must not be memoised for the rest of the TTL.
    gmailListCache.delete(key);
    throw error;
  });
  gmailListCache.set(key, { at: Date.now(), promise });
  return promise;
};

const markIngested = async (recipient, id) => {
  invalidateListCache();
  return active().markIngested(recipient, id);
};

const remove = async (recipient, id) => {
  invalidateListCache();
  return active().remove(recipient, id);
};

const reset = async () => {
  invalidateListCache();
  return active().reset();
};

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
 * The store is imported on demand: it reaches playwright-core through the
 * browser reader, and nothing on the boot path may load that — a backend
 * without Chrome must start exactly as before.
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
