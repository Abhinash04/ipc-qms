import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { findUserById } from '@/constants/mockUsers';
import { ListChecksIcon, CheckCircle2, CircleDot } from 'lucide-react';

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
    <ol className="space-y-4 select-none">
      {ordered.map((step, index) => {
        const assignee = step.assignedUserId ? findUserById(step.assignedUserId) : null;
        const label =
          step.stepType === 'REVIEW'
            ? `Review level ${reviewOrder.indexOf(step.stepId) + 1}`
            : STEP_LABEL[step.stepType] || step.stepType;

        const isCompleted = step.status === 'COMPLETED';
        const isInProgress = step.status === 'IN_PROGRESS';
        const isCurrent = step.stepId === currentStepId;

        return (
          <li key={step.stepId} className="flex gap-4">
            {/* Timeline Dot Indicator */}
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                  isCompleted
                    ? 'bg-emerald-500 text-white border-emerald-600 shadow-2xs'
                    : isInProgress
                    ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                    : 'bg-slate-100 text-slate-400 border-slate-300'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : isInProgress ? (
                  <CircleDot className="h-3.5 w-3.5 animate-pulse" strokeWidth={2.5} />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                )}
              </div>

              {index < ordered.length - 1 && (
                <span className={`w-0.5 my-1.5 flex-1 min-h-[24px] ${isCompleted ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              )}
            </div>

            {/* Step Content */}
            <div className="pb-3 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-black text-slate-800">{label}</span>
                <StatusBadge type="step" value={step.status} />
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    current
                  </span>
                )}
              </div>
              <p className="text-[12.5px] font-medium text-slate-400 mt-1">
                {assignee?.name || 'Unassigned'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
