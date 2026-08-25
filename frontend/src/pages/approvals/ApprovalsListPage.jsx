import { QueryTable } from '@/components/workflow/QueryTable';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

export function ApprovalsListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Approvals"
      greeting="Final Approval 🛡️"
      purpose="Reviewed drafts awaiting final Officer-in-Charge approval."
      breadcrumbItems={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Approvals' }]}
      detailPath={paths.APPROVAL_DETAIL}
      filter={(q) => q.workflowState === WORKFLOW_STATE.PENDING_FINAL_APPROVAL}
      emptyMessage="Nothing awaiting final approval. All review levels must complete first."
    />
  );
}
