import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { DashboardActivity } from "@/components/dashboard/DashboardActivity";
import { ROLES, ROLE_LABELS } from "@/constants/roles";

export function OICDashboard({
  currentUser,
  queries,
  workflowSteps,
  auditEvents,
  reviews,
}) {
  // Also the fallback view for Admin / Super Admin, whose role resolves to the
  // systemwide bucket set.
  const isOic = currentUser?.role === ROLES.OFFICER_IN_CHARGE;

  return (
    <BucketDashboard
      role={currentUser?.role}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title={isOic ? "Officer-in-Charge Dashboard" : "System Dashboard"}
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
