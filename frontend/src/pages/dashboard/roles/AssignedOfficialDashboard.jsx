import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { DashboardActivity } from "@/components/dashboard/DashboardActivity";
import { ROLES, ROLE_LABELS } from "@/constants/roles";

export function AssignedOfficialDashboard({
  currentUser,
  queries,
  workflowSteps,
  auditEvents,
  reviews,
}) {
  return (
    <BucketDashboard
      role={ROLES.ASSIGNED_OFFICIAL}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title="Officer Dashboard"
      purpose={
        <>
          Overview ·{" "}
          <span className="font-medium text-slate-500">
            {currentUser?.name} ({ROLE_LABELS[currentUser?.role]})
          </span>
        </>
      }
      emptyTextFor={(bucket) =>
        `Nothing in ${bucket?.label || "this list"}. Cases appear here when they reach a stage you own.`
      }
      sidePanel={<DashboardActivity auditEvents={auditEvents} />}
    />
  );
}
