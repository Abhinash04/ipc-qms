import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { AuthLayout } from '@/layouts/AuthLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ROUTE_PATHS, roleHome } from '@/constants/routePaths';
import { ROLE_ROUTES } from '@/routes/roleRoutes';
import { useAuthStore } from '@/store/useAuthStore';
// Lazy in production, eager under vitest — see routeElements.jsx.
import { MainLayout, LoginPage, SignUpPage, SECTION_ELEMENT } from '@/routes/routeElements';

function RouteFallback() {
  return (
    <div
      className="h-screen w-full flex items-center justify-center"
      role="status"
      aria-label="Loading page"
    >
      <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
    </div>
  );
}

export function AppRoutes() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const home = currentUser ? roleHome(currentUser.role) : ROUTE_PATHS.LOGIN;

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />

        <Route element={<AuthLayout />}>
          <Route path={ROUTE_PATHS.LOGIN} element={<LoginPage />} />
          <Route path={ROUTE_PATHS.SIGNUP} element={<SignUpPage />} />
        </Route>

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          {ROLE_ROUTES.map(({ path, section }) => (
            <Route key={path} path={path} element={SECTION_ELEMENT[section]} />
          ))}
        </Route>
      </Routes>
    </Suspense>
  );
}
