import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

export function ReviewsListPage() {
  return (
    <QueryTable
      title="Reviews"
      purpose="Queries awaiting your review, across all dynamic review levels."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Reviews' }]}
      detailPath={ROUTE_PATHS.REVIEW_DETAIL}
      filter={(q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW}
      emptyMessage="Nothing to review. A query appears here once the assigned official submits a draft."
    />
  );
}
