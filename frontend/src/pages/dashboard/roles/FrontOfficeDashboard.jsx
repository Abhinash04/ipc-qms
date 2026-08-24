import { Inbox, CheckCircle2, Clock, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { ROLE_LABELS } from '@/constants/roles';

function countSince(auditEvents, event, days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= d).length;
}

export function FrontOfficeDashboard({ currentUser, queries, auditEvents }) {
  const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

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
      subtextColor: 'text-amber-600',
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'drafting',
      icon: Clock,
    },
    {
      label: 'Open Queries',
      caption: 'In progress',
      value: openQueries.length,
      trendText: receivedThisWeek ? `+${receivedThisWeek} received this week` : null,
      trendType: 'up',
      subtextMain: `Total active cases`,
      subtextColor: 'text-blue-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'review',
      icon: Inbox,
    },
    {
      label: 'Closed Today',
      caption: 'Dispatched & finished',
      value: closedToday,
      trendText: null,
      trendType: 'up',
      subtextMain: `${closedToday} sent out today`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={`Hello, ${firstName} 👋`}
        title="Front Office Dashboard"
        purpose={
          <>
            Role-specific overview · <span className="font-medium text-slate-500">{currentUser?.name} ({ROLE_LABELS[currentUser?.role]})</span>
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
