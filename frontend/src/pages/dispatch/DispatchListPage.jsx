import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { WORKFLOW_STATE } from "@/constants/statusEnums";

const DISPATCHABLE = [
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];

export function DispatchListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Dispatch"
      greeting="Dispatch Management 🚀"
      purpose="Approved responses ready to send to the inquirer, for Front Office."
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Dispatch" },
      ]}
      detailPath={paths.DISPATCH_DETAIL}
      filter={(q) => DISPATCHABLE.includes(q.workflowState)}
      emptyMessage="Nothing ready for dispatch. A query appears here after final approval."
    />
  );
}
