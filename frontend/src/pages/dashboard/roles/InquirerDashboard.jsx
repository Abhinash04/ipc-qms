import { Inbox, CheckCircle2, FileText, Activity } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { DashboardQueryList } from '@/components/dashboard/DashboardQueryList';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { ROLES } from '@/constants/roles';
import { RoleGate } from '@/components/common/RoleGate';
import { Plus as PlusIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { isQueryOwnedBy } from '@/utils/queryOwnership';
import { getTimeBasedGreeting } from '@/utils/greeting';

export function InquirerDashboard({ currentUser, queries }) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  const myQueries = queries.filter((q) => isQueryOwnedBy(q, currentUser));

  const openQueries = myQueries.filter(q => q.workflowState !== WORKFLOW_STATE.CLOSED);
  const closedQueries = myQueries.filter(q => q.workflowState === WORKFLOW_STATE.CLOSED);

  const kpis = [
    {
      label: 'Open Queries',
      caption: 'In progress',
      value: openQueries.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `${openQueries.length} currently open`,
      subtextColor: 'text-blue-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'review',
      icon: Inbox,
      onClick: () => paths.QUERIES && navigate(paths.QUERIES),
    },
    {
      label: 'Resolved Queries',
      caption: 'Completed',
      value: closedQueries.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `${closedQueries.length} total closed`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed',
      icon: CheckCircle2,
      onClick: () => paths.QUERIES && navigate(paths.QUERIES),
    },
    {
      label: 'Total Submitted',
      caption: 'Lifetime',
      value: myQueries.length,
      trendText: null,
      trendType: 'up',
      subtextMain: `Total cases`,
      subtextColor: 'text-slate-600',
      cardBg: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      cardBorder: '#e2e8f0',
      numColor: '#475569',
      illustrationType: 'assigned',
      icon: FileText,
      onClick: () => paths.QUERIES && navigate(paths.QUERIES),
    }
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title="My Queries"
        purpose={
          <>
            Client Portal · <span className="font-medium text-slate-500">{currentUser?.name}</span>
          </>
        }
        actions={
          <RoleGate allow={[ROLES.INQUIRER]}>
            <button
              type="button"
              onClick={() => navigate(paths.COMPOSE)}
              className="flex items-center gap-2 text-[13px] font-semibold text-white bg-blue-600 border-none rounded-xl px-4 py-2.5 cursor-pointer shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              New Query
            </button>
          </RoleGate>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
        <DashboardQueryList
          title="My Queries Status"
          subtitle="Track the status of all your submitted queries"
          icon={Activity}
          items={myQueries}
          totalCount={myQueries.length}
          emptyText="You haven't submitted any queries yet."
        />
      </div>
    </div>
  );
}
