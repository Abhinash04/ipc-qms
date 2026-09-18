import { useCallback, useState } from "react";

import { notify } from "@/services/notify";

/**
 * The reason, not the transport's description of the reason.
 *
 * Axios stringifies a rejection as "Request failed with status code 403", which
 * is what the Officer-in-Charge saw for ten minutes while the server had been
 * saying "OFFICER_IN_CHARGE may not perform DISPATCH" in the response body the
 * whole time. Every error the API raises carries `{ error: <sentence> }` — see
 * `middleware/errorHandler.js` — so read that first and keep the axios string
 * only for failures that never reached the server.
 */
function reasonFor(caught) {
  return (
    caught?.response?.data?.error ||
    caught?.message ||
    String(caught)
  );
}

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
      const message = reasonFor(caught);
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
