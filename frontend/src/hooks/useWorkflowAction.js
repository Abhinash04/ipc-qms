import { useCallback, useState } from "react";

import { notify } from "@/services/notify";

/**
 * The one seam every workflow action failure passes through — assign, draft,
 * submit for review, approve, request revision, final approve, dispatch,
 * forward. The toast is raised from the thrown error, so it reports what the
 * operation actually did rather than that a button was pressed: an action that
 * succeeds raises nothing here, and its success toast comes from the committed
 * audit event instead.
 *
 * The inline banner stays: it is the persistent, in-context explanation next to
 * the control. The toast is the immediate alert for a user who has looked away.
 */
export function useWorkflowAction() {
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async (action) => {
    setError(null);
    setRunning(true);
    try {
      await action();
      return true;
    } catch (caught) {
      const message = caught?.message || String(caught);
      setError(message);
      notify.error("Action could not be completed", message);
      return false;
    } finally {
      setRunning(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, running, error, clearError };
}
