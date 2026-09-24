import env from '../../../config/env.js';
import browserConfig from '../../../config/browserConfig.js';
import { isConnected } from '../../../config/db.js';

/**
 * Keeps the NICeMail mailbox read on a timer instead of only when somebody is
 * looking at it.
 *
 * Until this existed, every sync was started by the signed-in Front Officer's
 * browser poll, so nobody signed in meant no mail ingested — an enquiry could
 * sit unread in NICeMail all weekend. The requirement is a sync roughly every
 * MAILBOX_SYNC_INTERVAL_MS whenever Chrome's CDP endpoint answers, regardless of
 * who is logged in.
 *
 * `setTimeout` chained rather than `setInterval`, because the delay changes: a
 * fixed interval cannot back off, and backing off is the whole of the breaker
 * below.
 *
 * This schedules work; it does not do any. Every tick goes through
 * `nicBrowserMailbox.syncIfDue`, which keeps its own single-flight, its TTL and —
 * the part that matters — its refusal to start while any browser work is queued.
 * A sync holds the one serialised CDP session for as long as it takes (one full
 * twenty-message sync was measured at 91 s), so an acknowledgement or a final
 * response must be able to go first. Calling `requestSync` here instead would
 * skip that check and let a timer starve a person.
 *
 * Which also means the interval is a floor, not a period: ticks that land while a
 * sync is running are absorbed by that single-flight, so the real cadence is
 * whichever is longer, the interval or the sync.
 *
 * Must not import nicBrowserMailbox.js at module load — that module may only be
 * loaded on demand, the same reason mailbox/index.js imports it inside `forUser`.
 */

/**
 * Consecutive failures push the next tick further out: 1x, 2x, 4x, then 20x the
 * interval.
 *
 * Nothing else in the server reads `status.ok` before trying again, so without
 * this a closed Chrome would be probed every fifteen seconds forever, each probe
 * paying a `fetch` plus up to NIC_BROWSER_TIMEOUT_MS. The shape mirrors
 * MailboxAutoSync's client-side BACKOFF_MS, so an operator watching either end
 * sees the same behaviour.
 */
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

/** Why a tick would do nothing, or null when it should run. */
function declineReason() {
  if (!browserConfig.mailboxEnabled) return 'the browser mailbox is off';
  if (!browserConfig.mailboxAddress) return 'NIC_EMAIL is not set';
  // Mongoose buffers a query against a disconnected client and then rejects on a
  // timeout, so asking now would cost a whole tick to learn nothing.
  if (!isConnected()) return 'the database is not connected';
  return null;
}

/**
 * One tick. Never throws: a scheduler that dies on a bad tick stops running
 * altogether, which is the failure nobody notices.
 */
export async function tickOnce({ now = Date.now() } = {}) {
  ticks += 1;
  const declined = declineReason();
  if (declined) return { ran: false, declined, failures };

  try {
    const store = await import('./nicBrowserMailbox.js');

    // Last attempt's outcome, read before starting another. `ok` is null until
    // something has been tried, which counts as neither success nor failure.
    const before = store.syncStatus();
    if (before.ok === true) failures = 0;
    else if (before.ok === false) failures = Math.min(failures + 1, BACKOFF_STEPS.length);

    store.syncIfDue(browserConfig.mailboxAddress);
    return { ran: true, declined: null, failures, at: now };
  } catch (error) {
    // Reaching here means the import or the status read failed, not the sync —
    // `syncIfDue` is fire-and-forget and swallows its own errors.
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

/**
 * Start the sync timer.
 *
 * Unref'd, so it can never hold the process open, and silent under
 * NODE_ENV=test — the suite has no Chrome and a background timer there would
 * only make it flaky. Idempotent: starting twice leaves one timer.
 */
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

/** Test seam: the breaker's state, which is otherwise invisible. */
export function syncSchedulerState() {
  return { running: Boolean(timer), failures, ticks, delayMs: delayMs() };
}

/** Test seam: forget the breaker's state between cases. */
export function resetSyncScheduler() {
  stopMailboxSync();
  failures = 0;
  ticks = 0;
}

export default { startMailboxSync, stopMailboxSync, tickOnce, syncSchedulerState };
