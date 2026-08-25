import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { WORKFLOW_STATE } from "@/constants/statusEnums";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export function ReviewsListPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);

  const isMyReview = (query) => {
    if (!currentUser) return false;
    if (query.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return false;
    const step = workflowSteps.find(
      (s) => s.stepId === query.currentWorkflowStepId,
    );
    return step?.assignedUserId === currentUser.id;
  };

  return (
    <QueryTable
      title="Reviews"
      greeting="Quality & Review 🔍"
      purpose="Queries waiting on your review level right now."
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Reviews" },
      ]}
      detailPath={paths.REVIEW_DETAIL}
      filter={isMyReview}
      emptyMessage="Nothing is waiting on you. A query appears here once it reaches your review level."
    />
  );
}
