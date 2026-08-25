import { QueryTable } from '@/components/workflow/QueryTable';
import { MailboxIngestButton } from '@/components/workflow/MailboxIngestButton';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLES } from '@/constants/roles';

export function QueriesListPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);

  const filter = (query) => {
    if (currentUser?.role === ROLES.ASSIGNED_OFFICIAL) {
      if (query.currentAssigneeId === currentUser.id) return true;
      const step = workflowSteps.find((s) => s.stepId === query.currentWorkflowStepId);
      return step?.assignedUserId === currentUser.id;
    }
    return true; 
  };

  const isAssignedOfficial = currentUser?.role === ROLES.ASSIGNED_OFFICIAL;

  return (
    <QueryTable
      title={isAssignedOfficial ? "Assigned Queries" : "Queries"}
      greeting="IPC Query Registry 📋"
      purpose={isAssignedOfficial ? "Queries currently assigned to you." : "All registered queries across the organization."}
      breadcrumbItems={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Queries' }]}
      detailPath={paths.QUERY_DETAIL}
      actions={!isAssignedOfficial && <MailboxIngestButton />}
      emptyMessage={isAssignedOfficial ? "No queries assigned to you yet." : "No queries yet. A case is created when an email is ingested from the IPC mailbox."}
      filter={filter}
    />
  );
}
