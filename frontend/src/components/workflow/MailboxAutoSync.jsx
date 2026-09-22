import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { notify } from '@/services/notify';
import { ROLES } from '@/constants/roles';

const POLL_MS = 30000;

/**
 * While the mailbox is unreachable, ask less often: 1, 2, then 5 minutes.
 *
 * A provider that is down stays down for minutes, and polling it every thirty
 * seconds only multiplies the failures — during a live DNS outage each attempt
 * also held a request open for the ten seconds the resolver took to give up.
 */
const BACKOFF_MS = [60000, 120000, 300000];

const UNREACHABLE = 'mailbox-unreachable';
const RECOVERED = 'mailbox-recovered';
const WAITING = 'mailbox-waiting';

/**
 * Tells the Front Officer that mail is waiting. It does not act on it.
 *
 * This component used to register, acknowledge and forward every unread message
 * it found, every thirty seconds, from whatever page happened to be open — so a
 * case could be opened and sent to the Officer-in-Charge without anyone having
 * read the email. The poll is still useful; what it may do with the result is
 * not. It now only counts what is waiting and points at the inbox, where a
 * human accepts or rejects each message.
 *
 * What it says is rationed just as carefully. An error toast stays until it is
 * dismissed, so a failing mailbox used to leave one permanent toast per poll —
 * a wall of identical messages for a single outage. An outage is announced
 * once, when it starts, and once more when it ends.
 */
export function MailboxAutoSync() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const { running, checkMailbox } = useMailboxIngestion();
  const latest = useRef({ running, checkMailbox });
  const failures = useRef(0);
  /** The waiting count already announced — more mail is news, the same mail is not. */
  const announced = useRef(0);

  useEffect(() => {
    latest.current = { running, checkMailbox };
  }, [running, checkMailbox]);

  useEffect(() => {
    if (role !== ROLES.FRONT_OFFICE) return undefined;

    let timer = null;
    let stopped = false;

    const schedule = (ms) => {
      if (!stopped) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (stopped) return;
      if (latest.current.running) return schedule(POLL_MS);

      const result = await latest.current
        .checkMailbox()
        .catch((error) => ({ fetched: 0, error: error?.message || String(error) }));

      if (stopped) return;

      /**
       * A mailbox the server could not READ answers 200 with whatever it had
       * stored and a `sync` saying why — so a dead NICeMail browser agent used
       * to look exactly like a healthy empty mailbox from here, and this poll
       * announced "no new mail" for as long as the outage lasted. Off the inbox
       * page, where the standing banner is, that was the only signal there was.
       */
      const unreachable =
        result.error ||
        (result.sync?.ok === false ? result.sync.error || 'The last mailbox sync failed.' : null);

      if (unreachable) {
        if (failures.current === 0) {
          notify.error('The IPC mailbox cannot be reached', unreachable, { id: UNREACHABLE });
        }
        failures.current += 1;
        return schedule(BACKOFF_MS[Math.min(failures.current - 1, BACKOFF_MS.length - 1)]);
      }

      if (failures.current > 0) {
        failures.current = 0;
        notify.dismiss(UNREACHABLE);
        notify.info('The IPC mailbox is reachable again', undefined, { id: RECOVERED });
      }

      const waiting = result.fetched || 0;
      if (waiting > announced.current) {
        notify.info(
          `${waiting} message${waiting === 1 ? '' : 's'} awaiting validation`,
          'Open the IPC mailbox to accept or reject them.',
          { id: WAITING },
        );
      }
      announced.current = waiting;

      return schedule(POLL_MS);
    }

    schedule(POLL_MS);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [role]);

  return null;
}
