import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { ROLES } from "@/constants/roles";

export function DraftingListPage() {
  const paths = useRoutePaths();
  const filter = useBucketFilter(ROLES.ASSIGNED_OFFICIAL, [
    "assigned",
    "drafting",
    "returned",
  ]);
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
      filter={filter}
      emptyMessage="Nothing to draft. A query appears here once the Officer-in-Charge assigns it to you."
    />
  );
}
