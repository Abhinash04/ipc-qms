import { QueryTable } from "@/components/workflow/QueryTable";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useRoutePaths } from "@/hooks/useRoutePaths";

export function MyWorkPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const isMine = (query) => {
    if (!currentUser) return false;
    if (query.currentAssigneeId === currentUser.id) return true;
    const step = workflowSteps.find(
      (s) => s.stepId === query.currentWorkflowStepId,
    );
    return step?.assignedUserId === currentUser.id;
  };

  return (
    <QueryTable
      title="My Work"
      greeting="My Assigned Work 💼"
      purpose={`Queries assigned to or awaiting action from ${currentUser?.name || "you"}.`}
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "My Work" },
      ]}
      detailPath={paths.QUERY_DETAIL}
      filter={isMine}
      emptyMessage="Nothing is waiting on you right now. Switch user in the header to act as another role."
    />
  );
}
