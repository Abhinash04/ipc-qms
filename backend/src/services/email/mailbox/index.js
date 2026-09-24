import { isConnected, isDatabaseConfigured } from '../../../config/db.js';
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

const mailboxSource = () =>
  (process.env.MAILBOX_SOURCE || env.MAILBOX_SOURCE || MAILBOX_SOURCES.AUTO).toLowerCase();

function active() {
  if (forced) return forced;
  if (mailboxSource() === MAILBOX_SOURCES.NIC) return nicInbox;
  return isConnected() || isDatabaseConfigured() ? mongoMailbox : memoryMailbox;
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

const supportsDelivery = () => active() !== nicInbox;

const deliver = async (message) => active().deliver(message);

const list = async (recipient, options) => active().list(recipient, options);

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
