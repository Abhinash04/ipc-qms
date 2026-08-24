import { BarChart3Icon, InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { StatTile } from '@/components/common/StatTile';
import { EmptyState } from '@/components/common/EmptyState';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '@/constants/statusEnums';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function ReportsPage() {
  const paths = useRoutePaths();
  const queries = useWorkflowStore((state) => state.queries);

  const kpis = [
    { 
      label: 'Total queries', 
      value: queries.length, 
      icon: InboxIcon,
      cardBg: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      cardBorder: '#e2e8f0',
      numColor: '#475569',
      illustrationType: 'assigned'
    },
    {
      label: 'In drafting',
      value: queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length,
      icon: PenLineIcon,
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'drafting'
    },
    {
      label: 'Under review',
      value: queries.filter((q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW).length,
      icon: ClipboardCheckIcon,
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'review'
    },
    {
      label: 'Closed',
      value: queries.filter((q) => q.businessStatus === BUSINESS_STATUS.CLOSED).length,
      icon: CheckCircle2Icon,
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed'
    },
  ];

  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Reports' }]} />
      <PageHeader title="Reports" purpose="Operational metrics and exports. Required metrics to be confirmed with client." />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} {...kpi} />
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
