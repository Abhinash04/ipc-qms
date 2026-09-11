import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { isRouteAllowedForRole } from '@/constants/permissions';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ProtectedRoute({ children }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const authReady = useAuthStore((state) => state.authReady);
  const location = useLocation();

  // Decide nothing until GET /auth/me has answered. Without this, a page
  // reload redirects an authenticated user to the login screen for the moment
  // before the session is restored from the cookie.
  //
  // A user that is already known means the session is settled whatever the
  // flag says — which is also what lets a test sign in with a plain
  // `setState({ currentUser })` and not have to know this mechanism exists.
  if (!authReady && !currentUser) return null;

  if (!currentUser) {
    return <Navigate to={ROUTE_PATHS.LOGIN} state={{ from: location.pathname }} replace />;
  }

  if (!isRouteAllowedForRole(currentUser.role, location.pathname)) {
    return (
      <div className="p-8">
        <p className="text-sm font-medium text-foreground">Access restricted</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {currentUser.name} ({currentUser.role}) does not have access to this page.
        </p>
      </div>
    );
  }

  return children;
}
