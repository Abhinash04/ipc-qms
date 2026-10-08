import { QueryTable } from "@/components/workflow/QueryTable";
import { useAuthStore } from "@/store/useAuthStore";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { ROLES } from "@/constants/roles";
import { useWatchedUser } from "@/hooks/useWatchedUser";

export function MyWorkPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const watcher = useWatchedUser([ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER]);
  const owner = watcher.watched || currentUser;
  const isMine = useBucketFilter(
    ROLES.ASSIGNED_OFFICIAL,
    ["assigned", "drafting", "submitted", "returned"],
    watcher.watched,
  );

  return (
    <QueryTable
      title="My Work"
      greeting="My Assigned Work 💼"
      purpose={
        watcher.observer && !watcher.watched
          ? "Every case someone is working on right now. Pick a user to see their queue as they see it."
          : `Queries assigned to or awaiting action from ${owner?.name || "you"}.`
      }
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "My Work" },
      ]}
      detailPath={paths.QUERY_DETAIL}
      filter={isMine}
      watcher={watcher}
      emptyMessage="Nothing is waiting on you right now. Switch user in the header to act as another role."
    />
  );
}
