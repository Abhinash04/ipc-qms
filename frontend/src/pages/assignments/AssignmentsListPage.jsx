import { QueryTable } from '@/components/workflow/QueryTable';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

const AWAITING_ASSIGNMENT = [WORKFLOW_STATE.PENDING_ASSIGNMENT, WORKFLOW_STATE.ASSIGNED];

export function AssignmentsListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Assignments"
      purpose="Queries pending assignment or currently assigned, for the Officer-in-Charge."
      breadcrumbItems={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Assignments' }]}
      detailPath={paths.ASSIGNMENT_DETAIL}
      filter={(q) => AWAITING_ASSIGNMENT.includes(q.workflowState)}
      emptyMessage="No queries are awaiting assignment. Front Office must verify and forward one first."
    />
  );
}
