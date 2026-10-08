import { useMemo } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { anyBucket, roleScope } from '@/constants/queryBuckets';

// asUser lets the Super Admin see a page exactly as that user sees it.
export function useBucketFilter(role, keys = null, asUser = null) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const reviews = useWorkflowStore((state) => state.reviews);
  const user = asUser || currentUser;

  return useMemo(() => {
    const ctx = { user, workflowSteps, reviews };
    return keys ? anyBucket(role, keys, ctx) : roleScope(role, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, keys && keys.join('|'), user, workflowSteps, reviews]);
}
