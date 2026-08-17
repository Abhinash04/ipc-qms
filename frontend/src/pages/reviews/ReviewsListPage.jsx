import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ReviewsListPage() {
  return (
    <QueryTable
      title="Reviews"
      purpose="Queries awaiting your review, across all dynamic review levels."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Reviews' }]}
      detailPath={ROUTE_PATHS.REVIEW_DETAIL}
    />
  );
}
