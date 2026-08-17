import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

const DISPATCHABLE = [
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];

export function DispatchListPage() {
  return (
    <QueryTable
      title="Dispatch"
      purpose="Approved responses ready to send to the inquirer, for Front Office."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Dispatch' }]}
      detailPath={ROUTE_PATHS.DISPATCH_DETAIL}
      filter={(q) => DISPATCHABLE.includes(q.workflowState)}
      emptyMessage="Nothing ready for dispatch. A query appears here after final approval."
    />
  );
}
