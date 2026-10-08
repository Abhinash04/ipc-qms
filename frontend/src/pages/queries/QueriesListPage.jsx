import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { useAuthStore } from "@/store/useAuthStore";
import { ROLES } from "@/constants/roles";
import { useWatchedUser } from "@/hooks/useWatchedUser";

export function QueriesListPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);

  const watcher = useWatchedUser([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]);
  const filter = useBucketFilter(
    watcher.watched?.role || currentUser?.role,
    null,
    watcher.watched,
  );

  const isAssignedOfficial = currentUser?.role === ROLES.ASSIGNED_OFFICIAL;

  return (
    <QueryTable
      title={isAssignedOfficial ? "Assigned Queries" : "Queries"}
      greeting="IPC Query Registry 📋"
      purpose={
        isAssignedOfficial
          ? "Queries assigned to you, and ones you worked on before they were transferred."
          : "All registered queries across the organization."
      }
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Queries" },
      ]}
      detailPath={paths.QUERY_DETAIL}
      emptyMessage={
        isAssignedOfficial
          ? "No queries assigned to you yet."
          : "No queries yet. A case is created when the Front Office accepts an email in the IPC mailbox."
      }
      filter={filter}
      watcher={watcher}
    />
  );
}
