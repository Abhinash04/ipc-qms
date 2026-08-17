import { Card, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { findUserById } from '@/constants/mockUsers';

/**
 * Sticky query-identity strip shown at the top of the Case Workspace and
 * every stage detail page. Answers Query → Status → Assignee → Stage in one
 * glance, per the requested Case Workspace information flow.
 */
export function CaseSummaryBar({ query }) {
  if (!query) return null;
  const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;

  return (
    <Card className="mb-6">
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{query.queryId}</p>
          <h1 className="mt-0.5 text-lg font-semibold text-foreground">{query.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge type="business" value={query.businessStatus} />
            <StatusBadge type="workflow" value={query.workflowState} />
            <StatusBadge type="priority" value={query.priority} />
          </div>
        </div>
        <div className="flex gap-6 text-sm sm:text-right">
          <div>
            <p className="text-xs text-muted-foreground">Assignee</p>
            <p className="font-medium text-foreground">{assignee?.name || 'Unassigned'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Due date</p>
            <p className="font-medium text-foreground">
              {query.dueDate ? new Date(query.dueDate).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
