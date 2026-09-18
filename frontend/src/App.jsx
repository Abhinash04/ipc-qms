import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';

function HydrationGate({ children }) {
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const hydrate = useWorkflowStore((state) => state.hydrate);
  // Waiting for the session here as well as in ProtectedRoute keeps the "/"
  // redirect from resolving to /login before we know who is signed in.
  const authReady = useAuthStore((state) => state.authReady);
  const currentUser = useAuthStore((state) => state.currentUser);

  // GET /queries requires a session, so the workflow store can only be loaded
  // once we know who is signed in. Re-runs when `currentUser` changes because
  // logout clears `hydrated` — signing in as someone else must not inherit the
  // previous account's view of the data.
  useEffect(() => {
    if (authReady && currentUser) hydrate();
  }, [authReady, currentUser, hydrate]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <p className="text-sm text-muted-foreground">Loading workflow data…</p>
      </div>
    );
  }

  // Signed out, there is nothing to hydrate and nothing the login screen needs
  // from the workflow store. Gating on `hydrated` here would hang on /login.
  if (currentUser && !hydrated) {
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
      {/* Outside the router so the login screen gets toasts too. Mounted after
          the gate, so the store is hydrated and the seeded audit history is
          never replayed as a burst of notifications. */}
      <NotificationHost />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </HydrationGate>
  );
}

export default App;
