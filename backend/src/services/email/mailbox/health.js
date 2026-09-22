import * as audit from '../../audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import { describeError } from '../delivery.js';

/**
 * Whether the mailbox can be reached — tracked across polls, not per poll.
 *
 * The inbox is polled every few seconds by two clients. When the provider goes
 * away, every one of those polls fails, and reporting each failure separately
 * buries the fact in noise: a live test produced a wall of identical
 * "Could not check the IPC mailbox" toasts and one stack trace per poll for the
 * same DNS outage.
 *
 * So an outage is reported on its edges — it began, it ended — and counted in
 * between. What the operator needs is "the mailbox has been unreachable since
 * 10:31, 48 polls", and that is what the audit trail, the log and the inbox
 * banner get.
 */

/** While failing, log at most this often; the count carries the rest. */
const LOG_INTERVAL_MS = 5 * 60 * 1000;

const initial = {
  ok: true,
  /** When the current outage began, ISO-8601. */
  since: null,
  failures: 0,
  lastError: null,
  at: null,
  loggedAt: 0,
};

let state = { ...initial };

const now = () => new Date().toISOString();

export function recordFailure({ source = null, address = null, error }) {
  const reason = describeError(error);
  const first = state.ok;
  const at = now();

  state = {
    ok: false,
    since: first ? at : state.since,
    failures: state.failures + 1,
    lastError: reason,
    at,
    loggedAt: state.loggedAt,
  };

  if (first) {
    console.warn(
      `[qms] the ${source || 'mail'} mailbox is unreachable: ${reason} — polling continues, ` +
        'further failures are counted rather than logged',
    );
    state.loggedAt = Date.now();

    audit.record({
      action: AUDIT_ACTIONS.SYNC_FAILED,
      actorType: ACTOR_TYPES.SYSTEM,
      result: AUDIT_RESULTS.FAILURE,
      error: reason,
      details: { source, address, since: state.since },
    });
    return state;
  }

  if (Date.now() - state.loggedAt >= LOG_INTERVAL_MS) {
    console.warn(
      `[qms] the ${source || 'mail'} mailbox is still unreachable since ${state.since} ` +
        `(${state.failures} failed polls): ${reason}`,
    );
    state.loggedAt = Date.now();
  }

  return state;
}

export function recordSuccess({ source = null, address = null } = {}) {
  if (state.ok) {
    state.at = now();
    return state;
  }

  const { since, failures, lastError } = state;
  const seconds = Math.max(1, Math.round((Date.now() - Date.parse(since)) / 1000));

  console.log(`[qms] the ${source || 'mail'} mailbox is reachable again after ${seconds}s (${failures} failed polls)`);

  audit.record({
    action: AUDIT_ACTIONS.SYNC_RECOVERED,
    actorType: ACTOR_TYPES.SYSTEM,
    result: AUDIT_RESULTS.SUCCESS,
    details: { source, address, since, failures, lastError, seconds },
  });

  state = { ...initial, at: now() };
  return state;
}

/** What the inbox page and /health read. Shaped like the NICeMail sync status. */
export function snapshot() {
  const { ok, since, failures, lastError, at } = state;
  return { ok, since, failures, error: lastError, at };
}

/** For tests. */
export function reset() {
  state = { ...initial };
}
