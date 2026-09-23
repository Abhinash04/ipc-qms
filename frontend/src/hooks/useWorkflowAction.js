import { useCallback, useState } from "react";

import { notify } from "@/services/notify";

function reasonFor(caught) {
  return (
    caught?.response?.data?.error ||
    caught?.message ||
    String(caught)
  );
}

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
