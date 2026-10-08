import env from '../../../config/env.js';
import browserConfig from '../../../config/browserConfig.js';
import { isConnected } from '../../../config/db.js';

const BACKOFF_STEPS = [1, 2, 4, 20];

let timer = null;
let failures = 0;
let ticks = 0;

const intervalMs = () => env.MAILBOX_SYNC_INTERVAL_MS;

function delayMs() {
  if (!failures) return intervalMs();
  const step = BACKOFF_STEPS[Math.min(failures, BACKOFF_STEPS.length) - 1];
  return intervalMs() * step;
}

function declineReason() {
  if (!browserConfig.mailboxEnabled) return 'the browser mailbox is off';
  if (!browserConfig.mailboxAddress) return 'NIC_EMAIL is not set';
  if (!isConnected()) return 'the database is not connected';
  return null;
}

export async function tickOnce({ now = Date.now() } = {}) {
  ticks += 1;
  const declined = declineReason();
  if (declined) return { ran: false, declined, failures };

  try {
    const store = await import('./nicBrowserMailbox.js');

    const before = store.syncStatus();
    if (before.ok === true) failures = 0;
    else if (before.ok === false) failures = Math.min(failures + 1, BACKOFF_STEPS.length);

    store.syncIfDue(browserConfig.mailboxAddress);
    return { ran: true, declined: null, failures, at: now };
  } catch (error) {
    failures = Math.min(failures + 1, BACKOFF_STEPS.length);
    console.warn(`[qms] mailbox sync tick failed: ${error.message}`);
    return { ran: false, declined: error.message, failures };
  }
}

function schedule() {
  timer = setTimeout(() => {
    void tickOnce().finally(() => {
      if (timer) schedule();
    });
  }, delayMs());
  timer.unref();
}

export function startMailboxSync() {
  if (env.NODE_ENV === 'test') return null;
  if (!env.MAILBOX_SYNC_ENABLED) return null;
  if (timer) return timer;

  failures = 0;
  schedule();
  return timer;
}

export function stopMailboxSync() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function syncSchedulerState() {
  return { running: Boolean(timer), failures, ticks, delayMs: delayMs() };
}

export function resetSyncScheduler() {
  stopMailboxSync();
  failures = 0;
  ticks = 0;
}

export default { startMailboxSync, stopMailboxSync, tickOnce, syncSchedulerState };
