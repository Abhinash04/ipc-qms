import { useAuthStore } from '@/store/useAuthStore';

export function RoleGate({ allow, children }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  if (!currentUser || !allow.includes(currentUser.role)) return null;
  return children;
}
