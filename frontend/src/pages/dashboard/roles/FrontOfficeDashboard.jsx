import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { DashboardActivity } from "@/components/dashboard/DashboardActivity";
import { ROLES, ROLE_LABELS } from "@/constants/roles";

export function FrontOfficeDashboard({
  currentUser,
  queries,
  workflowSteps,
  auditEvents,
  reviews,
}) {
  return (
    <BucketDashboard
      role={ROLES.FRONT_OFFICE}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title="Front Office Dashboard"
      purpose={
        <>
          Overview ·{" "}
          <span className="font-medium text-slate-500">
            {currentUser?.name} ({ROLE_LABELS[currentUser?.role]})
          </span>
        </>
      }
      sidePanel={<DashboardActivity auditEvents={auditEvents} />}
    />
  );
}
