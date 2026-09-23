import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { ROLES } from "@/constants/roles";

export function InquirerDashboard({
  currentUser,
  queries,
  workflowSteps,
  reviews,
}) {
  return (
    <BucketDashboard
      role={ROLES.INQUIRER}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title="My Queries"
      purpose={
        <>
          Client Portal ·{" "}
          <span className="font-medium text-slate-500">{currentUser?.name}</span>
        </>
      }
      emptyTextFor={(bucket) =>
        bucket?.key === "total"
          ? "You haven't raised any queries yet."
          : `You have no ${bucket?.label?.toLowerCase() || "queries"} right now.`
      }
    />
  );
}
