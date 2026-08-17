import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';

/**
 * Gate rendering until IndexedDB has been read. Without this the first paint
 * would show the in-memory seed and a user could act on stale state before
 * their persisted progress loads.
 */
function HydrationGate({ children }) {
  const hydrated = useWorkflowStore((state) => state.hydrated);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <p className="text-sm text-muted-foreground">Loading workflow data…</p>
      </div>
    );
  }

  return children;
}

function App() {
  return (
    <HydrationGate>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </HydrationGate>
  );
}

export default App;
