import BarChart3Icon from 'lucide-react/dist/esm/icons/bar-chart-3.mjs';
import InboxIcon from 'lucide-react/dist/esm/icons/inbox.mjs';
import PenLineIcon from 'lucide-react/dist/esm/icons/pen-line.mjs';
import ClipboardCheckIcon from 'lucide-react/dist/esm/icons/clipboard-check.mjs';
import CheckCircle2Icon from 'lucide-react/dist/esm/icons/check-circle-2.mjs';

import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { StatTile } from '@/components/common/StatTile';
import { EmptyState } from '@/components/common/EmptyState';
import { ROUTE_PATHS } from '@/constants/routePaths';

const KPIS = [
  { label: 'Assigned to you', value: 1, icon: InboxIcon },
  { label: 'In drafting', value: 1, icon: PenLineIcon },
  { label: 'Awaiting your review', value: 0, icon: ClipboardCheckIcon },
  { label: 'Closed this month', value: 0, icon: CheckCircle2Icon },
];

export function ReportsPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Reports' }]} />
      <PageHeader title="Reports" purpose="Operational metrics and exports. Required metrics to be confirmed with client." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {KPIS.map((kpi) => (
          <StatTile key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} />
        ))}
      </div>

      <EmptyState
        icon={BarChart3Icon}
        title="No reporting data source connected"
        description="Turnaround-time, volume-by-category, and SLA-compliance charts are proposed but not confirmed — see docs/srs/11-dashboard-and-reporting.md."
      />
    </div>
  );
}
