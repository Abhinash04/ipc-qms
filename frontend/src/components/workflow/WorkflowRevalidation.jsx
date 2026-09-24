import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';

const FRESH_MS = 2000;

function revalidateIfStale() {
  const { hydrated, refreshedAt, revalidate } = useWorkflowStore.getState();
  if (!hydrated || !useAuthStore.getState().currentUser || navigator.onLine === false) return;
  if (Date.now() - refreshedAt < FRESH_MS) return;
  revalidate();
}

function revalidateIfVisible() {
  if (document.visibilityState === 'visible') revalidateIfStale();
}

export function WorkflowRevalidation() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    revalidateIfStale();
  }, [pathname]);

  useEffect(() => {
    window.addEventListener('focus', revalidateIfStale);
    document.addEventListener('visibilitychange', revalidateIfVisible);
    return () => {
      window.removeEventListener('focus', revalidateIfStale);
      document.removeEventListener('visibilitychange', revalidateIfVisible);
    };
  }, []);

  return null;
}
