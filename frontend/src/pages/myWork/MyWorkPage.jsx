import { QueryTable } from "@/components/workflow/QueryTable";
import { useAuthStore } from "@/store/useAuthStore";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { ROLES } from "@/constants/roles";

export function MyWorkPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const isMine = useBucketFilter(ROLES.ASSIGNED_OFFICIAL, [
    "assigned",
    "drafting",
    "submitted",
    "returned",
  ]);

  return (
    <QueryTable
      title="My Work"
      greeting="My Assigned Work 💼"
      purpose={`Queries assigned to or awaiting action from ${currentUser?.name || "you"}.`}
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "My Work" },
      ]}
      detailPath={paths.QUERY_DETAIL}
      filter={isMine}
      emptyMessage="Nothing is waiting on you right now. Switch user in the header to act as another role."
    />
  );
}
