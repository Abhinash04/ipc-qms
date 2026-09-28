import { BarChart3Icon, InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { StatTile } from '@/components/common/StatTile';
import { EmptyState } from '@/components/common/EmptyState';
import { Panel, PanelHeader } from '@/components/admin/Panel';
import { AreaTrendChart, DonutChart } from '@/components/charts/Charts';
import { statusDistribution, volumeSeries } from '@/components/admin/adminStats';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '@/constants/statusEnums';
import { STATE_GROUPS } from '@/constants/queryBuckets';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const DRAFTING_STATES = STATE_GROUPS.DRAFTING_STAGE;

export function ReportsPage() {
  const paths = useRoutePaths();
  const queries = useWorkflowStore((state) => state.queries);
  const total = queries.length;
  const shareOf = (count) => (total > 0 ? count / total : null);

  const drafting = queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length;
  const underReview = queries.filter((q) => q.workflowState === WORKFLOW_STATE.UNDER_REVIEW).length;
  const closed = queries.filter((q) => q.businessStatus === BUSINESS_STATUS.CLOSED).length;

  const kpis = [
    { label: 'Total queries', value: total, icon: InboxIcon, tone: 'primary', share: total ? 1 : null },
    { label: 'In drafting', value: drafting, icon: PenLineIcon, tone: 'amber', share: shareOf(drafting) },
    { label: 'Under review', value: underReview, icon: ClipboardCheckIcon, tone: 'blue', share: shareOf(underReview) },
    { label: 'Closed', value: closed, icon: CheckCircle2Icon, tone: 'emerald', share: shareOf(closed) },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Reports' }]} />
      <PageHeader title="Reports" purpose="Operational metrics and exports. Required metrics to be confirmed with client." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} shareTotal={total} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" aria-labelledby="reports-arrivals">
          <PanelHeader
            id="reports-arrivals"
            title="Queries received"
            note="Weekly arrivals over the last 12 weeks"
          />
          <AreaTrendChart
            series={[{ name: 'Queries', points: volumeSeries(queries, 'quarter') }]}
            height={260}
            label="Queries received per week"
          />
        </Panel>
        <Panel aria-labelledby="reports-status">
          <PanelHeader id="reports-status" title="Status mix" note="Business status of every query" />
          <DonutChart slices={statusDistribution(queries)} height={260} label="Queries by business status" totalLabel="Queries" />
        </Panel>
      </div>

      <EmptyState
        icon={BarChart3Icon}
        title="No reporting data source connected"
        description="Counts above are computed from the cases this browser has loaded from the server. Turnaround-time, volume-by-category, and SLA-compliance charts are proposed but not confirmed — see docs/srs/11-dashboard-and-reporting.md."
      />
    </div>
  );
}
