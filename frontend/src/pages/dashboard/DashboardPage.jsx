import { Link } from 'react-router-dom';
import { InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLE_LABELS } from '@/constants/roles';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

export function DashboardPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);

  const mine = queries.filter((q) => q.currentAssigneeId === currentUser?.id);
  const awaitingMyReview = queries.filter((q) => {
    if (q.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return false;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const kpis = [
    { label: 'Assigned to you', value: mine.length, icon: InboxIcon },
    {
      label: 'In drafting',
      value: queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length,
      icon: PenLineIcon,
    },
    { label: 'Awaiting your review', value: awaitingMyReview.length, icon: ClipboardCheckIcon },
    {
      label: 'Closed',
      value: queries.filter((q) => q.workflowState === WORKFLOW_STATE.CLOSED).length,
      icon: CheckCircle2Icon,
    },
  ];

  const myQueue = queries.filter((q) => {
    if (q.currentAssigneeId === currentUser?.id) return true;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        purpose={`Role-specific overview for ${currentUser?.name} (${ROLE_LABELS[currentUser?.role]}).`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">Waiting on you</h2>
        </CardHeader>
        <CardBody className={myQueue.length === 0 ? 'p-4' : undefined}>
          {myQueue.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="Nothing waiting on you"
              description="Switch user in the header to act as the role this query is currently with."
            />
          ) : (
            <div className="space-y-3">
              {myQueue.map((query) => (
                <div key={query.queryId} className="flex items-center justify-between gap-4">
                  <div>
                    <Link
                      to={buildPath(paths.QUERY_DETAIL, { queryId: query.queryId })}
                      className="font-medium text-ring hover:underline"
                    >
                      {query.queryId}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">{query.subject}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <StatusBadge type="priority" value={query.priority} />
                    <StatusBadge type="workflow" value={query.workflowState} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
