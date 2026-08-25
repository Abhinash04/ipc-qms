import { useNavigate } from 'react-router-dom';
import { Inbox, FileText, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { ROLE_LABELS } from '@/constants/roles';
import { getTimeBasedGreeting } from '@/utils/greeting';
import { useRoutePaths } from '@/hooks/useRoutePaths';

export function AssignedOfficialDashboard({ currentUser, queries, auditEvents, workflowSteps }) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  const myQueries = queries.filter((q) => {
    if (q.currentAssigneeId === currentUser?.id) return true;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const draftingCount = myQueries.filter((q) => q.workflowState === WORKFLOW_STATE.DRAFTING || q.workflowState === WORKFLOW_STATE.ASSIGNED).length;
  const underReviewCount = myQueries.filter((q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW).length;
  const returnedCount = myQueries.filter((q) => q.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION).length;

  const kpis = [
    {
      label: 'In Investigation / Drafting',
      caption: 'Requires your draft',
      value: draftingCount,
      trendText: null,
      trendType: 'up',
      subtextMain: `↑ ${draftingCount} require draft response`,
      subtextSecondary: 'Action needed',
      cardBg: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'drafting',
      icon: Clock,
      onClick: () => paths.DRAFTING && navigate(paths.DRAFTING),
    },
    {
      label: 'Submitted for Review',
      caption: 'With Reviewers',
      value: underReviewCount,
      trendText: null,
      trendType: 'neutral',
      subtextMain: `↑ ${underReviewCount} pending approval`,
      subtextSecondary: 'Awaiting reviewer feedback',
      cardBg: 'linear-gradient(180deg, #faf5ff 0%, #ffffff 100%)',
      cardBorder: '#e9d5ff',
      numColor: '#9333ea',
      illustrationType: 'review',
      icon: FileText,
      onClick: () => (paths.MY_WORK || paths.QUERIES) && navigate(paths.MY_WORK || paths.QUERIES),
    },
    {
      label: 'Returned for Revision',
      caption: 'Action needed',
      value: returnedCount,
      trendText: null,
      trendType: returnedCount > 0 ? 'down' : 'neutral',
      subtextMain: returnedCount > 0 ? `! ${returnedCount} returned for changes` : 'No returned drafts',
      subtextSecondary: 'Revision required',
      cardBg: returnedCount > 0 ? 'linear-gradient(180deg, #fff1f2 0%, #ffffff 100%)' : 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      cardBorder: returnedCount > 0 ? '#fecdd3' : '#e2e8f0',
      numColor: returnedCount > 0 ? '#e11d48' : '#64748b',
      illustrationType: 'review',
      icon: Inbox,
      onClick: () => paths.DRAFTING && navigate(paths.DRAFTING),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title="Officer Dashboard"
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
          title="Waiting on you"
          subtitle="Queries requiring your action (Drafting, Revision, etc.)"
          icon={FileText}
          items={myQueries}
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
