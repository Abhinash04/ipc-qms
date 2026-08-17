import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { isRouteAllowedForRole } from '@/constants/permissions';

/** Gates a route by the current mock user's role/permission map. */
export function ProtectedRoute({ children }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const location = useLocation();

  if (!currentUser) {
    return <div className="p-8 text-sm text-muted-foreground">Not signed in.</div>;
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
