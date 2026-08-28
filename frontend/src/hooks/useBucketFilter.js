import { useMemo } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { anyBucket, roleScope } from '@/constants/queryBuckets';

export function useBucketFilter(role, keys = null) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const reviews = useWorkflowStore((state) => state.reviews);

  return useMemo(() => {
    const ctx = { user: currentUser, workflowSteps, reviews };
    return keys ? anyBucket(role, keys, ctx) : roleScope(role, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, keys && keys.join('|'), currentUser, workflowSteps, reviews]);
}
