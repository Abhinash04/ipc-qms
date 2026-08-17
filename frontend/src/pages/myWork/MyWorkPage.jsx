import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function MyWorkPage() {
  return (
    <QueryTable
      title="My Work"
      purpose="Queries currently assigned to or awaiting action from you."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'My Work' }]}
      detailPath={ROUTE_PATHS.QUERY_DETAIL}
    />
  );
}
