import { useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '@/routes/AppRoutes';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ThemeApplier } from '@/components/theme/ThemeApplier';

function ScrollToTop() {
  const { pathname, search } = useLocation();

  useLayoutEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const mainScroll = document.getElementById('main-scroll');
      if (mainScroll) {
        mainScroll.scrollTop = 0;
      }
    };

    resetScroll();

    const frameId = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frameId);
  }, [pathname, search]);

  return null;
}

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
          <ScrollToTop />
          <AppRoutes />
        </BrowserRouter>
      </HydrationGate>
    </>
  );
}

export default App;
