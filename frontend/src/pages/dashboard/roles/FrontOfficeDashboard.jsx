import { useNavigate } from 'react-router-dom';
import { Inbox, CheckCircle2, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { ROLE_LABELS } from '@/constants/roles';
import { getTimeBasedGreeting } from '@/utils/greeting';
import { useRoutePaths } from '@/hooks/useRoutePaths';

function countSince(auditEvents, event, days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= d).length;
}

export function FrontOfficeDashboard({ currentUser, queries, auditEvents }) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  const pendingDispatch = queries.filter(q => q.workflowState === WORKFLOW_STATE.PENDING_DISPATCH);
  const openQueries = queries.filter(q => q.workflowState !== WORKFLOW_STATE.CLOSED && q.workflowState !== WORKFLOW_STATE.PENDING_VERIFICATION);
  const closedToday = countSince(auditEvents, AUDIT_EVENT.QUERY_CLOSED, 1);
  const receivedThisWeek = countSince(auditEvents, AUDIT_EVENT.QUERY_RECEIVED, 7);

  const kpis = [
    {
      label: 'Pending Dispatch',
      caption: 'Ready to send',
      value: pendingDispatch.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${pendingDispatch.length} require dispatch`,
      subtextSecondary: 'Ready for delivery',
      cardBg: 'linear-gradient(180deg, #faf5ff 0%, #ffffff 100%)',
      cardBorder: '#e9d5ff',
      numColor: '#9333ea',
      illustrationType: 'dispatch',
      icon: Inbox,
      onClick: () => paths.DISPATCH && navigate(paths.DISPATCH),
    },
    {
      label: 'Active Queries',
      caption: 'In progress',
      value: openQueries.length,
      trendText: null,
      trendType: 'neutral',
      subtextMain: `↑ ${openQueries.length} total active`,
      subtextSecondary: 'Cross-functional',
      cardBg: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'open',
      icon: FileText,
      onClick: () => paths.QUERIES && navigate(paths.QUERIES),
    },
    {
      label: 'Closed Today',
      caption: 'Last 24 hours',
      value: closedToday,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${closedToday} resolved today`,
      subtextSecondary: `${receivedThisWeek} received this week`,
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed',
      icon: CheckCircle2,
      onClick: () => paths.INBOX && navigate(paths.INBOX),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title="Front Office Dashboard"
        purpose={
          <>
            Overview · <span className="font-medium text-slate-500">{currentUser?.name} ({ROLE_LABELS[currentUser?.role]})</span>
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
          title="Pending Dispatch"
          subtitle="Queries finalized by Reviewers, awaiting dispatch to inquirers"
          icon={FileText}
          items={pendingDispatch}
          totalCount={queries.length}
          emptyText="No queries pending dispatch right now."
        />
        
        <div className="sticky top-6 self-start">
          <DashboardActivity auditEvents={auditEvents} />
        </div>
      </div>
    </div>
  );
}
