import { isConnected } from '../../../config/db.js';
import * as memoryMailbox from './mockIpcMailbox.js';
import * as mongoMailbox from './mongoIpcMailbox.js';

let forced = null;

function forceInMemory() {
  forced = memoryMailbox;
}

function useAuto() {
  forced = null;
}

function active() {
  if (forced) return forced;
  return isConnected() ? mongoMailbox : memoryMailbox;
}

function describe() {
  const impl = active();
  const isMongo = impl === mongoMailbox;
  return {
    backend: isMongo ? 'mongo' : 'in-memory',
    persistence: isMongo
      ? 'MongoDB; survives backend restart'
      : 'in-memory; cleared on backend restart',
  };
}

const deliver = async (message) => active().deliver(message);
const list = async (recipient, options) => active().list(recipient, options);
const markIngested = async (recipient, id) => active().markIngested(recipient, id);
const reset = async () => active().reset();
const stats = async () => active().stats();

export { deliver, list, markIngested, reset, stats, describe, forceInMemory, useAuto };
