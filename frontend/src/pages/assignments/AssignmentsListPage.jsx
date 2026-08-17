import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function AssignmentsListPage() {
  return (
    <QueryTable
      title="Assignments"
      purpose="Queries pending assignment or currently assigned, for the Officer-in-Charge."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Assignments' }]}
      detailPath={ROUTE_PATHS.ASSIGNMENT_DETAIL}
    />
  );
}
