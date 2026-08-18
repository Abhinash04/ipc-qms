import { WorkflowIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { useRoutePaths } from '@/hooks/useRoutePaths';

export function AdminWorkflowsPage() {
  const paths = useRoutePaths();
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Admin', path: paths.ADMINISTRATION }, { label: 'Workflows' }]} />
      <PageHeader title="Workflows" purpose="Configure dynamic review-level templates for query categories." />
      <EmptyState
        icon={WorkflowIcon}
        title="No workflow templates yet"
        description="Workflow-step templates aren't implemented — the underlying model is dynamic (WorkflowInstance → WorkflowStep[N]); see docs/architecture/workflow-engine.md."
      />
    </div>
  );
}
