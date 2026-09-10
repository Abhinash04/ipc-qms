import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';

function HydrationGate({ children }) {
  const hydrated = useWorkflowStore((state) => state.hydrated);
  // Waiting for the session here as well as in ProtectedRoute keeps the "/"
  // redirect from resolving to /login before we know who is signed in.
  const authReady = useAuthStore((state) => state.authReady);

  if (!hydrated || !authReady) {
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
