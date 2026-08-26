import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "@/services/api/healthService";

export function useHealthCheck() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
    refetchInterval: 30000,
  });
}
