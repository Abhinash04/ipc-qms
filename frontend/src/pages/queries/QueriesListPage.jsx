import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function QueriesListPage() {
  return (
    <QueryTable
      title="Queries"
      purpose="All registered queries across the organization."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Queries' }]}
      detailPath={ROUTE_PATHS.QUERY_DETAIL}
    />
  );
}
