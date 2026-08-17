import { useAuthStore } from '@/store/useAuthStore';

/** Renders children only if the current mock user's role is in `allow`. */
export function RoleGate({ allow, children }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  if (!currentUser || !allow.includes(currentUser.role)) return null;
  return children;
}
