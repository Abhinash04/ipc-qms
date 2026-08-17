import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function DispatchListPage() {
  return (
    <QueryTable
      title="Dispatch"
      purpose="Approved responses ready to send to the inquirer, for Front Office."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Dispatch' }]}
      detailPath={ROUTE_PATHS.DISPATCH_DETAIL}
    />
  );
}
