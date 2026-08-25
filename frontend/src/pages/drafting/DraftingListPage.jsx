import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { WORKFLOW_STATE } from "@/constants/statusEnums";

const IN_DRAFTING = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function DraftingListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Drafting"
      greeting="Investigation & Drafting ✍️"
      purpose="Queries currently in investigation & drafting, for Assigned Officials."
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Drafting" },
      ]}
      detailPath={paths.DRAFTING_DETAIL}
      filter={(q) => IN_DRAFTING.includes(q.workflowState)}
      emptyMessage="Nothing to draft. A query appears here once the Officer-in-Charge assigns it."
    />
  );
}
