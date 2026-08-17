import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ApprovalsListPage() {
  return (
    <QueryTable
      title="Approvals"
      purpose="Reviewed drafts awaiting final Officer-in-Charge approval."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Approvals' }]}
      detailPath={ROUTE_PATHS.APPROVAL_DETAIL}
    />
  );
}
