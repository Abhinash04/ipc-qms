import { QueryTable } from '@/components/workflow/QueryTable';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

const IN_DRAFTING = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function DraftingListPage() {
  return (
    <QueryTable
      title="Drafting"
      purpose="Queries currently in investigation & drafting, for Assigned Officials."
      breadcrumbItems={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Drafting' }]}
      detailPath={ROUTE_PATHS.DRAFTING_DETAIL}
      filter={(q) => IN_DRAFTING.includes(q.workflowState)}
      emptyMessage="Nothing to draft. A query appears here once the Officer-in-Charge assigns it."
    />
  );
}
