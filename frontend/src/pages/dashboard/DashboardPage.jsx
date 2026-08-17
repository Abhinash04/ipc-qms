import { Link } from 'react-router-dom';
import InboxIcon from 'lucide-react/dist/esm/icons/inbox.mjs';
import PenLineIcon from 'lucide-react/dist/esm/icons/pen-line.mjs';
import ClipboardCheckIcon from 'lucide-react/dist/esm/icons/clipboard-check.mjs';
import CheckCircle2Icon from 'lucide-react/dist/esm/icons/check-circle-2.mjs';

import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLE_LABELS } from '@/constants/roles';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { buildPath, ROUTE_PATHS } from '@/constants/routePaths';

const KPIS = [
  { label: 'Assigned to you', value: 1, icon: InboxIcon },
  { label: 'In drafting', value: 1, icon: PenLineIcon },
  { label: 'Awaiting your review', value: 0, icon: ClipboardCheckIcon },
  { label: 'Closed this month', value: 0, icon: CheckCircle2Icon },
];

export function DashboardPage() {
  const currentUser = useAuthStore((state) => state.currentUser);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        purpose={`Role-specific overview for ${currentUser?.name} (${ROLE_LABELS[currentUser?.role]}).`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {KPIS.map((kpi) => (
          <StatTile key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">Your assigned queries</h2>
        </CardHeader>
        <CardBody>
          <div className="flex items-center justify-between">
            <div>
              <Link
                to={buildPath(ROUTE_PATHS.QUERY_DETAIL, { queryId: MOCK_QUERY.queryId })}
                className="font-medium text-ring hover:underline"
              >
                {MOCK_QUERY.queryId}
              </Link>
              <p className="mt-0.5 text-sm text-muted-foreground">{MOCK_QUERY.subject}</p>
            </div>
            <div className="flex gap-2">
              <StatusBadge type="priority" value={MOCK_QUERY.priority} />
              <StatusBadge type="workflow" value={MOCK_QUERY.workflowState} />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
