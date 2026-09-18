import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion, notifyMailboxCheck } from '@/hooks/useMailboxIngestion';
import { ROLES } from '@/constants/roles';

const POLL_MS = 30000;

/**
 * Tells the Front Officer that mail is waiting. It does not act on it.
 *
 * This component used to register, acknowledge and forward every unread message
 * it found, every thirty seconds, from whatever page happened to be open — so a
 * case could be opened and sent to the Officer-in-Charge without anyone having
 * read the email. The poll is still useful; what it may do with the result is
 * not. It now only counts what is waiting and points at the inbox, where a
 * human accepts or rejects each message.
 */
export function MailboxAutoSync() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const { running, checkMailbox } = useMailboxIngestion();
  const latest = useRef({ running, checkMailbox });

  useEffect(() => {
    latest.current = { running, checkMailbox };
  }, [running, checkMailbox]);

  useEffect(() => {
    if (role !== ROLES.FRONT_OFFICE) return undefined;

    const timer = setInterval(() => {
      if (latest.current.running) return;
      // A background poll speaks up only when mail is waiting or when the
      // mailbox could not be reached — never to say "nothing happened".
      latest.current
        .checkMailbox()
        .then((result) => notifyMailboxCheck(result, { announceIdle: false }))
        .catch(() => {});
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [role]);

  return null;
}
