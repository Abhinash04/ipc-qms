import { useAuthStore } from "@/store/useAuthStore";
import { pathsForRole } from "@/constants/routePaths";

export function useRoutePaths() {
  const role = useAuthStore((state) => state.currentUser?.role);
  return pathsForRole(role);
}
