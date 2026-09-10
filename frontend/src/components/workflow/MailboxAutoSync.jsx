import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion, notifyIngestResult } from '@/hooks/useMailboxIngestion';
import { ROLES } from '@/constants/roles';

const POLL_MS = 30000;

export function MailboxAutoSync() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const { running, ingestNow } = useMailboxIngestion();
  const latest = useRef({ running, ingestNow });

  useEffect(() => {
    latest.current = { running, ingestNow };
  }, [running, ingestNow]);

  useEffect(() => {
    if (role !== ROLES.FRONT_OFFICE) return undefined;

    const timer = setInterval(() => {
      if (latest.current.running) return;
      // A background poll speaks up only when it registered something or when
      // the mailbox could not be reached — never to say "nothing happened".
      latest.current
        .ingestNow()
        .then((result) => notifyIngestResult(result, { announceIdle: false }))
        .catch(() => {});
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [role]);

  return null;
}
