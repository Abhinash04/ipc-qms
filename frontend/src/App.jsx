import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ThemeApplier } from '@/components/theme/ThemeApplier';

function HydrationGate({ children }) {
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const hydrate = useWorkflowStore((state) => state.hydrate);
  const authReady = useAuthStore((state) => state.authReady);
  const currentUser = useAuthStore((state) => state.currentUser);

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
    <>
      <ThemeApplier />
      <HydrationGate>
        <NotificationHost />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </HydrationGate>
    </>
  );
}

export default App;
