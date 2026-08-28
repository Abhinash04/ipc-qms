import { useCallback, useState } from "react";

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
      setError(caught?.message || String(caught));
      return false;
    } finally {
      setRunning(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, running, error, clearError };
}
