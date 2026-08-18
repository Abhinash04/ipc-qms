import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { isRouteAllowedForRole } from '@/constants/permissions';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ProtectedRoute({ children }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const location = useLocation();

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
