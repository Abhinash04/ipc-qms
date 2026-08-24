import { UserCheck, Activity, User, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { DashboardResolutionRate } from '@/components/dashboard/DashboardResolutionRate';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { ROLE_LABELS } from '@/constants/roles';

function countSince(auditEvents, event, days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= d).length;
}

export function OICDashboard({ currentUser, queries, auditEvents }) {
  const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

  const pendingAssignment = queries.filter(q => q.workflowState === WORKFLOW_STATE.PENDING_ASSIGNMENT);
  const activeCount = queries.filter(q => q.workflowState !== WORKFLOW_STATE.CLOSED).length;
  const assignedThisWeek = countSince(auditEvents, AUDIT_EVENT.QUERY_ASSIGNED, 7);

  const closedQueryIds = new Set(
    queries.filter((q) => q.workflowState === WORKFLOW_STATE.CLOSED).map((q) => q.queryId),
  );

  const kpis = [
    {
      label: 'Pending Assignment',
      caption: 'Requires action',
      value: pendingAssignment.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${pendingAssignment.length} need assigning`,
      subtextColor: 'text-amber-600',
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'drafting',
      icon: User,
    },
    {
      label: 'Assigned This Week',
      caption: 'Throughput',
      value: assignedThisWeek,
      trendText: null,
      trendType: 'up',
      subtextMain: `${assignedThisWeek} assigned in last 7 days`,
      subtextColor: 'text-blue-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'assigned',
      icon: UserCheck,
    },
    {
      label: 'Active Queries',
      caption: 'In progress overall',
      value: activeCount,
      trendText: null,
      trendType: 'up',
      subtextMain: `${activeCount} currently active`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed',
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={`Hello, ${firstName} 👋`}
        title="Officer-in-Charge Dashboard"
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
          title="Pending Assignment"
          subtitle="Queries received by IPC awaiting official assignment"
          icon={FileText}
          items={pendingAssignment}
          totalCount={queries.length}
          emptyText="No queries pending assignment."
        />
        
        <div className="sticky top-6 self-start">
          <DashboardResolutionRate visibleAudit={auditEvents} closedQueryIds={closedQueryIds} />
        </div>
      </div>
    </div>
  );
}
