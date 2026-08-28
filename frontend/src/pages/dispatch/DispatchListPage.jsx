import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { ROLES } from "@/constants/roles";

export function DispatchListPage() {
  const paths = useRoutePaths();
  const filter = useBucketFilter(ROLES.FRONT_OFFICE, [
    "awaitingDispatch",
    "dispatched",
  ]);
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
      filter={filter}
      emptyMessage="Nothing ready for dispatch. A query appears here after final approval."
    />
  );
}
