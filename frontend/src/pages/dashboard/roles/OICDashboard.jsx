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
  const isOic = currentUser?.role === ROLES.OFFICER_IN_CHARGE;

  return (
    <BucketDashboard
      role={currentUser?.role}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title={isOic ? "Officer-in-Charge Dashboard" : "System Dashboard"}
      purpose={`Overview for ${currentUser?.name} · ${ROLE_LABELS[currentUser?.role]}`}
      sidePanel={<DashboardActivity auditEvents={auditEvents} />}
    />
  );
}
