import { QueryTable } from "@/components/workflow/QueryTable";
import { MailboxIngestButton } from "@/components/workflow/MailboxIngestButton";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { useAuthStore } from "@/store/useAuthStore";
import { ROLES } from "@/constants/roles";

export function QueriesListPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);

  // The role's own visibility rule — the same one the dashboard scopes by.
  const filter = useBucketFilter(currentUser?.role);

  const isAssignedOfficial = currentUser?.role === ROLES.ASSIGNED_OFFICIAL;

  return (
    <QueryTable
      title={isAssignedOfficial ? "Assigned Queries" : "Queries"}
      greeting="IPC Query Registry 📋"
      purpose={
        isAssignedOfficial
          ? "Queries currently assigned to you."
          : "All registered queries across the organization."
      }
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Queries" },
      ]}
      detailPath={paths.QUERY_DETAIL}
      actions={!isAssignedOfficial && <MailboxIngestButton />}
      emptyMessage={
        isAssignedOfficial
          ? "No queries assigned to you yet."
          : "No queries yet. A case is created when an email is ingested from the IPC mailbox."
      }
      filter={filter}
    />
  );
}
