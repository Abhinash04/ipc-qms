import { useNavigate } from "react-router-dom";
import { ClipboardCheck, CheckCircle2, XCircle, FileText } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatTile } from "@/components/common/StatTile";
import { DashboardQueryList } from "@/components/dashboard/DashboardQueryList";
import { DashboardRecentlyClosed } from "@/components/dashboard/DashboardRecentlyClosed";
import { WORKFLOW_STATE, AUDIT_EVENT } from "@/constants/statusEnums";
import { ROLE_LABELS } from "@/constants/roles";
import { getTimeBasedGreeting } from "@/utils/greeting";
import { useRoutePaths } from "@/hooks/useRoutePaths";

function countSince(auditEvents, event, days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= d)
    .length;
}

function newestFirst(events) {
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function ReviewerDashboard({
  currentUser,
  queries,
  workflowSteps,
  auditEvents,
}) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  const awaitingMyReview = queries.filter((q) => {
    if (
      q.workflowState !== WORKFLOW_STATE.UNDER_REVIEW &&
      q.workflowState !== WORKFLOW_STATE.PENDING_FINAL_APPROVAL
    )
      return false;
    const step = workflowSteps.find(
      (s) => s.stepId === q.currentWorkflowStepId,
    );
    return step?.assignedUserId === currentUser?.id;
  });

  const approvedToday =
    countSince(auditEvents, AUDIT_EVENT.REVIEW_APPROVED, 1) +
    countSince(auditEvents, AUDIT_EVENT.FINAL_APPROVAL_GRANTED, 1);
  const rejectedToday =
    countSince(auditEvents, AUDIT_EVENT.REVISION_REQUESTED, 1) +
    countSince(auditEvents, AUDIT_EVENT.FINAL_APPROVAL_REJECTED, 1);

  const recentlyClosed = newestFirst(
    auditEvents.filter((e) => e.event === AUDIT_EVENT.QUERY_CLOSED),
  )
    .slice(0, 3)
    .map((event) => {
      const query = queries.find((q) => q.queryId === event.queryId);
      return {
        queryId: event.queryId,
        subject: query?.subject || "(no subject)",
        closedAt: event.at,
        division: "Unassigned",
      };
    });

  const kpis = [
    {
      label: "Awaiting Review",
      caption: "Your review queue",
      value: awaitingMyReview.length,
      trendText: null,
      trendType: "down",
      subtextMain: `↓ ${awaitingMyReview.length} awaiting review`,
      subtextColor: "text-amber-600",
      cardBg: "linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)",
      cardBorder: "#fde68a",
      numColor: "#d97706",
      illustrationType: "review",
      icon: ClipboardCheck,
      onClick: () => paths.REVIEWS && navigate(paths.REVIEWS),
    },
    {
      label: "Approved Today",
      caption: "Passed review",
      value: approvedToday,
      trendText: null,
      trendType: "up",
      subtextMain: `${approvedToday} drafts approved today`,
      subtextColor: "text-emerald-600",
      cardBg: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
      cardBorder: "#bbf7d0",
      numColor: "#059669",
      illustrationType: "closed",
      icon: CheckCircle2,
      onClick: () =>
        (paths.APPROVALS || paths.QUERIES) &&
        navigate(paths.APPROVALS || paths.QUERIES),
    },
    {
      label: "Returned Today",
      caption: "Sent for revision",
      value: rejectedToday,
      trendText: null,
      trendType: "down",
      subtextMain: `${rejectedToday} sent back for edits`,
      subtextColor: "text-rose-600",
      cardBg: "linear-gradient(180deg, #fff5f6 0%, #ffffff 100%)",
      cardBorder: "#fecdd3",
      numColor: "#e11d48",
      illustrationType: "drafting",
      icon: XCircle,
      onClick: () =>
        (paths.REVIEWS || paths.QUERIES) &&
        navigate(paths.REVIEWS || paths.QUERIES),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title="Reviewer Dashboard"
        purpose={
          <>
            Overview ·{" "}
            <span className="font-medium text-slate-500">
              {currentUser?.name} ({ROLE_LABELS[currentUser?.role]})
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-4">
        <DashboardQueryList
          title="Awaiting My Review"
          subtitle="Drafts submitted by officials that need your approval"
          icon={FileText}
          items={awaitingMyReview}
          totalCount={queries.length}
          emptyText="Your review queue is empty."
        />

        <div className="sticky top-6 self-start">
          <DashboardRecentlyClosed recentlyClosed={recentlyClosed} />
        </div>
      </div>
    </div>
  );
}
