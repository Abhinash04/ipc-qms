import { useEffect } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { TOAST_EVENTS } from '@/constants/toastEvents';
import { notify, inBatch } from '@/services/notify';

export function NotificationHost() {
  useEffect(() => {
    let seen = useWorkflowStore.getState().auditEvents.length;

    const unsubscribe = useWorkflowStore.subscribe((state) => {
      const events = state.auditEvents;

      if (events.length < seen) {
        seen = events.length;
        return;
      }
      if (events.length === seen) return;

      const fresh = events.slice(seen);
      seen = events.length;

      if (inBatch()) return;

      for (const event of fresh) {
        const spec = TOAST_EVENTS[event.event];
        if (!spec) continue;
        notify[spec.type](spec.title, event.details || event.queryId);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let previous = useWorkflowStore.getState().persistenceError;

    return useWorkflowStore.subscribe((state) => {
      const current = state.persistenceError;
      if (current === previous) return;
      previous = current;
      if (!current) return;

      notify.error(
        'Could not save your work locally',
        `${current} — recent changes may be lost if you reload.`,
      );
    });
  }, []);

  return <Toaster />;
}
