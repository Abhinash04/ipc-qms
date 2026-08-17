import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

const AWAITING_ASSIGNMENT = [WORKFLOW_STATE.PENDING_ASSIGNMENT, WORKFLOW_STATE.ASSIGNED];

export function AssignmentsListPage() {
  return (
    <QueryTable
      title="Assignments"
      purpose="Queries pending assignment or currently assigned, for the Officer-in-Charge."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Assignments' }]}
      detailPath={ROUTE_PATHS.ASSIGNMENT_DETAIL}
      filter={(q) => AWAITING_ASSIGNMENT.includes(q.workflowState)}
      emptyMessage="No queries are awaiting assignment. Front Office must verify and forward one first."
    />
  );
}
