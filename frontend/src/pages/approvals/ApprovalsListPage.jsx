import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { ROLES } from "@/constants/roles";

export function ApprovalsListPage() {
  const paths = useRoutePaths();
  const filter = useBucketFilter(ROLES.OFFICER_IN_CHARGE, [
    "awaitingFinalApproval",
  ]);
  return (
    <QueryTable
      title="Approvals"
      greeting="Final Approval 🛡️"
      purpose="Reviewed drafts awaiting final Officer-in-Charge approval."
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Approvals" },
      ]}
      detailPath={paths.APPROVAL_DETAIL}
      filter={filter}
      emptyMessage="Nothing awaiting final approval. All review levels must complete first."
    />
  );
}
