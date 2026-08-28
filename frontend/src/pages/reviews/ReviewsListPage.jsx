import { QueryTable } from "@/components/workflow/QueryTable";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useBucketFilter } from "@/hooks/useBucketFilter";
import { ROLES } from "@/constants/roles";

export function ReviewsListPage() {
  const paths = useRoutePaths();
  const isMyReview = useBucketFilter(ROLES.REVIEWER, ["awaitingReview"]);

  return (
    <QueryTable
      title="Reviews"
      greeting="Quality & Review 🔍"
      purpose="Queries waiting on your review level right now."
      breadcrumbItems={[
        { label: "Dashboard", path: paths.DASHBOARD },
        { label: "Reviews" },
      ]}
      detailPath={paths.REVIEW_DETAIL}
      filter={isMyReview}
      emptyMessage="Nothing is waiting on you. A query appears here once it reaches your review level."
    />
  );
}
