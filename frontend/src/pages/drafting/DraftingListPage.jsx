import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function DraftingListPage() {
  return (
    <QueryTable
      title="Drafting"
      purpose="Queries currently in investigation & drafting, for Assigned Officials."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Drafting' }]}
      detailPath={ROUTE_PATHS.DRAFTING_DETAIL}
    />
  );
}
