import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '@/services/api/healthService';

/** Demonstrates the frontend/backend wiring — polls GET /api/v1/health. */
export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: false,
    refetchInterval: 30000,
  });
}
