import { Inbox, UserCheck, PenLine, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { ROLE_LABELS } from '@/constants/roles';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

function countSince(auditEvents, event, days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= d).length;
}

export function AssignedOfficialDashboard({ currentUser, queries, workflowSteps, auditEvents }) {
  const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

  const mine = queries.filter((q) => q.currentAssigneeId === currentUser?.id);
  
  const myQueue = queries.filter((q) => {
    if (q.currentAssigneeId === currentUser?.id) return true;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const draftsCount = mine.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length;
  const returnedCount = mine.filter(q => q.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION).length;
  const assignedThisWeek = countSince(auditEvents, AUDIT_EVENT.QUERY_ASSIGNED, 7);

  const kpis = [
    {
      label: 'Assigned to you',
      caption: 'Cases you own',
      value: mine.length,
      trendText: assignedThisWeek ? `+${assignedThisWeek} this week` : null,
      trendType: 'up',
      subtextMain: `↑ ${mine.length} assigned to you`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'assigned',
      icon: UserCheck,
    },
    {
      label: 'In drafting',
      caption: 'Being written',
      value: draftsCount,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${draftsCount} in draft state`,
      subtextColor: 'text-amber-600',
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'drafting',
      icon: PenLine,
    },
    {
      label: 'Returned for Revision',
      caption: 'Needs updates',
      value: returnedCount,
      trendText: returnedCount > 0 ? 'Action required' : 'All good',
      trendType: returnedCount > 0 ? 'down' : 'up',
      subtextMain: `${returnedCount} returned by reviewer`,
      subtextColor: returnedCount > 0 ? 'text-rose-600' : 'text-slate-400',
      cardBg: returnedCount > 0 ? 'linear-gradient(180deg, #fff5f6 0%, #ffffff 100%)' : 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      cardBorder: returnedCount > 0 ? '#fecdd3' : '#e2e8f0',
      numColor: returnedCount > 0 ? '#e11d48' : '#64748b',
      illustrationType: 'review',
      icon: Inbox,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={`Hello, ${firstName} 👋`}
        title="Official Dashboard"
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
          title="Waiting on you"
          subtitle="Queries requiring your action (Drafting, Revision, etc.)"
          icon={FileText}
          items={myQueue}
          totalCount={queries.length}
          emptyText="Nothing waiting on you. Queries appear here when they reach a stage you own."
        />
        
        <div className="sticky top-6 self-start">
          <DashboardActivity auditEvents={auditEvents} />
        </div>
      </div>
    </div>
  );
}
