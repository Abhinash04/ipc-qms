import { useEffect } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { TOAST_EVENTS } from '@/constants/toastEvents';
import { notify, inBatch } from '@/services/notify';

/**
 * Renders the toast surface and connects it to committed workflow transitions.
 *
 * The subscription watches `auditEvents`, which only grows when
 * `applyTransition` has actually committed a state change. A click that threw
 * before the transition — a refused action, a failed email, an unresolvable
 * attachment — appends nothing, so it raises no toast. That is the whole point
 * of listening here rather than in the button handlers.
 */
export function NotificationHost() {
  useEffect(() => {
    // The store is hydrated before this mounts (App gates on it), so the
    // events already present are history, not news.
    let seen = useWorkflowStore.getState().auditEvents.length;

    const unsubscribe = useWorkflowStore.subscribe((state) => {
      const events = state.auditEvents;

      if (events.length < seen) {
        // The list shrank — resetDemo() replaced the state. Re-baseline
        // instead of treating the seed events as new activity.
        seen = events.length;
        return;
      }
      if (events.length === seen) return;

      const fresh = events.slice(seen);
      seen = events.length;

      // A mailbox sweep reports itself once; its transitions stay in the audit
      // trail either way.
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
    // Saving to IndexedDB failed. Until now this only appeared in a header pill
    // that is hidden below the xl breakpoint, so most users never saw it.
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
