import { QueryTable } from '@/components/workflow/QueryTable';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function MyWorkPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);

  /** Mine if I'm the assignee, or the step the query is sitting on is mine. */
  const isMine = (query) => {
    if (!currentUser) return false;
    if (query.currentAssigneeId === currentUser.id) return true;
    const step = workflowSteps.find((s) => s.stepId === query.currentWorkflowStepId);
    return step?.assignedUserId === currentUser.id;
  };

  return (
    <QueryTable
      title="My Work"
      purpose={`Queries assigned to or awaiting action from ${currentUser?.name || 'you'}.`}
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'My Work' }]}
      detailPath={ROUTE_PATHS.QUERY_DETAIL}
      filter={isMine}
      emptyMessage="Nothing is waiting on you right now. Switch user in the header to act as another role."
    />
  );
}
