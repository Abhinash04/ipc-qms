import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { DashboardRecentlyClosed } from "@/components/dashboard/DashboardRecentlyClosed";
import { AUDIT_EVENT } from "@/constants/statusEnums";
import { ROLES, ROLE_LABELS } from "@/constants/roles";
import { findUserById } from "@/constants/mockUsers";
import { findDivisionById } from "@/constants/mockDivisions";

function newestFirst(events) {
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function ReviewerDashboard({
  currentUser,
  queries,
  workflowSteps,
  auditEvents,
  reviews,
}) {
  const recentlyClosed = newestFirst(
    auditEvents.filter((e) => e.event === AUDIT_EVENT.QUERY_CLOSED),
  )
    .slice(0, 3)
    .map((event) => {
      const query = queries.find((q) => q.queryId === event.queryId);
      const assignee = query?.currentAssigneeId
        ? findUserById(query.currentAssigneeId)
        : null;
      return {
        queryId: event.queryId,
        subject: query?.subject || "(no subject)",
        closedAt: event.at,
        division: findDivisionById(assignee?.divisionId)?.name || "Unassigned",
      };
    });

  return (
    <BucketDashboard
      role={ROLES.REVIEWER}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title="Reviewer Dashboard"
      purpose={
        <>
          Overview ·{" "}
          <span className="font-medium text-slate-500">
            {currentUser?.name} ({ROLE_LABELS[currentUser?.role]})
          </span>
        </>
      }
      emptyTextFor={(bucket) =>
        bucket?.key === "awaitingReview"
          ? "Your review queue is empty."
          : `Nothing in ${bucket?.label || "this list"} yet.`
      }
      sidePanel={<DashboardRecentlyClosed recentlyClosed={recentlyClosed} />}
    />
  );
}
