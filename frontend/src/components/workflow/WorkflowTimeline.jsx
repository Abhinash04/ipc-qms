import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { findUserById } from '@/constants/mockUsers';
import ListChecksIcon from 'lucide-react/dist/esm/icons/list-checks.mjs';

const DOT_CLASS = {
  COMPLETED: 'bg-status-green-fg',
  IN_PROGRESS: 'bg-status-blue-fg',
  PENDING: 'bg-status-gray-line',
};

const STEP_LABEL = {
  DRAFT: 'Draft',
  REVIEW: 'Review',
  FINAL_APPROVAL: 'Final Approval',
};

export function WorkflowTimeline({ steps, currentStepId }) {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={ListChecksIcon}
        title="No workflow steps yet"
        description="Steps are created once the assigned official submits a draft for review."
      />
    );
  }

  const reviewOrder = ordered.filter((s) => s.stepType === 'REVIEW').map((s) => s.stepId);

  return (
    <ol className="space-y-4">
      {ordered.map((step, index) => {
        const assignee = step.assignedUserId ? findUserById(step.assignedUserId) : null;
        const label =
          step.stepType === 'REVIEW'
            ? `Review level ${reviewOrder.indexOf(step.stepId) + 1}`
            : STEP_LABEL[step.stepType] || step.stepType;

        return (
          <li key={step.stepId} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[step.status] || DOT_CLASS.PENDING}`} />
              {index < ordered.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
            </div>
            <div className="pb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <StatusBadge type="step" value={step.status} />
                {step.stepId === currentStepId && (
                  <span className="text-xs font-medium text-ring">current</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{assignee?.name || 'Unassigned'}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
