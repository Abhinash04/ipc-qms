import { useNavigate } from 'react-router-dom';
import { UserCheck, CheckCircle2, Clock, FileText } from 'lucide-react';
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

export function OICDashboard({ currentUser, queries, auditEvents }) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  const pendingAssignment = queries.filter(q => q.workflowState === WORKFLOW_STATE.PENDING_VERIFICATION || q.workflowState === WORKFLOW_STATE.REGISTERED);
  const openQueries = queries.filter(q => q.workflowState !== WORKFLOW_STATE.CLOSED);
  const closedToday = countSince(auditEvents, AUDIT_EVENT.QUERY_CLOSED, 1);
  const assignedThisWeek = countSince(auditEvents, AUDIT_EVENT.QUERY_ASSIGNED, 7);

  const kpis = [
    {
      label: 'Pending Assignment',
      caption: 'Awaiting officer',
      value: pendingAssignment.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${pendingAssignment.length} need officer assignment`,
      subtextColor: 'text-amber-600',
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'assigned',
      icon: UserCheck,
      onClick: () => (paths.ASSIGNMENTS || paths.QUERIES) && navigate(paths.ASSIGNMENTS || paths.QUERIES),
    },
    {
      label: 'Active System Cases',
      caption: 'In progress overall',
      value: openQueries.length,
      trendText: assignedThisWeek ? `+${assignedThisWeek} assigned this week` : null,
      trendType: 'up',
      subtextMain: `Total active queries`,
      subtextColor: 'text-blue-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'open',
      icon: Clock,
      onClick: () => paths.QUERIES && navigate(paths.QUERIES),
    },
    {
      label: 'Closed Today',
      caption: 'Systemwide',
      value: closedToday,
      trendText: null,
      trendType: 'up',
      subtextMain: `${closedToday} cases closed today`,
      subtextColor: 'text-emerald-600',
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
          <DashboardActivity auditEvents={auditEvents} />
        </div>
      </div>
    </div>
  );
}
