import WorkflowIcon from 'lucide-react/dist/esm/icons/workflow.mjs';

import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function AdminWorkflowsPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Admin', path: ROUTE_PATHS.ADMIN }, { label: 'Workflows' }]} />
      <PageHeader title="Workflows" purpose="Configure dynamic review-level templates for query categories." />
      <EmptyState
        icon={WorkflowIcon}
        title="No workflow templates yet"
        description="Workflow-step templates aren't implemented — the underlying model is dynamic (WorkflowInstance → WorkflowStep[N]); see docs/architecture/workflow-engine.md."
      />
    </div>
  );
}
