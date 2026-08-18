import { QueryTable } from '@/components/workflow/QueryTable';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

export function ReviewsListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Reviews"
      purpose="Queries awaiting your review, across all dynamic review levels."
      breadcrumbItems={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Reviews' }]}
      detailPath={paths.REVIEW_DETAIL}
      filter={(q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW}
      emptyMessage="Nothing to review. A query appears here once the assigned official submits a draft."
    />
  );
}
