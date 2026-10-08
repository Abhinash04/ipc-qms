import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { notify } from '@/services/notify';
import { ROLES } from '@/constants/roles';

const POLL_MS = 30000;

const BACKOFF_MS = [60000, 120000, 300000];

const UNREACHABLE = 'mailbox-unreachable';
const RECOVERED = 'mailbox-recovered';
const WAITING = 'mailbox-waiting';

export function MailboxAutoSync() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const { running, checkMailbox } = useMailboxIngestion();
  const latest = useRef({ running, checkMailbox });
  const failures = useRef(0);
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
