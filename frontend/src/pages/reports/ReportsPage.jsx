import { BarChart3Icon, InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { StatTile } from '@/components/common/StatTile';
import { EmptyState } from '@/components/common/EmptyState';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '@/constants/statusEnums';
import { ROUTE_PATHS } from '@/constants/routePaths';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function ReportsPage() {
  const queries = useWorkflowStore((state) => state.queries);

  const kpis = [
    { label: 'Total queries', value: queries.length, icon: InboxIcon },
    {
      label: 'In drafting',
      value: queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length,
      icon: PenLineIcon,
    },
    {
      label: 'Under review',
      value: queries.filter((q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW).length,
      icon: ClipboardCheckIcon,
    },
    {
      label: 'Closed',
      value: queries.filter((q) => q.businessStatus === BUSINESS_STATUS.CLOSED).length,
      icon: CheckCircle2Icon,
    },
  ];

  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Reports' }]} />
      <PageHeader title="Reports" purpose="Operational metrics and exports. Required metrics to be confirmed with client." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} />
        ))}
      </div>

      <EmptyState
        icon={BarChart3Icon}
        title="No reporting data source connected"
        description="Counts above are computed live from the mock workflow store. Turnaround-time, volume-by-category, and SLA-compliance charts are proposed but not confirmed — see docs/srs/11-dashboard-and-reporting.md."
      />
    </div>
  );
}
