import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';

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
