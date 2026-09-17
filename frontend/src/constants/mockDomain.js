/**
 * Bump whenever buildSeedState() or the persisted shape changes.
 *
 * Browsers keep their cases in IndexedDB and are only seeded when that store is
 * empty, so without this stamp a changed seed never reaches anyone who has
 * already opened the app — they keep serving cases that no longer exist. It
 * starts at 2 because the seed has already changed once (it used to ship five
 * demo queries; cases now arrive through mailbox ingestion instead), and an
 * unstamped database must be treated as stale.
 */
export const SEED_VERSION = 2;

export function buildSeedState() {
  return {
    queries: [],
    workflowSteps: [],
    reviews: [],
    responseVersions: [],
    auditEvents: [],
    notifications: [],
    emailMessages: [],
    emailThreads: [],
    counters: { QRY: 0, THREAD: 0, MSG: 0, AUD: 0, NOTIF: 0, STEP: 0, REV: 0, RESP: 0 },
  };
}
