import { StatusBadge } from '@/components/common/StatusBadge';

const DOT_CLASS = {
  COMPLETED: 'bg-status-green-fg',
  IN_PROGRESS: 'bg-status-blue-fg',
  PENDING: 'bg-status-gray-line',
};

/** Renders a dynamic WorkflowStep[] as an ordered timeline — no fixed review1/2/3 fields. */
export function WorkflowTimeline({ steps }) {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);

  return (
    <ol className="space-y-4">
      {ordered.map((step, index) => (
        <li key={step.stepId} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[step.status] || DOT_CLASS.PENDING}`} />
            {index < ordered.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className="pb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{step.stepType.replace(/_/g, ' ')}</span>
              <StatusBadge type="step" value={step.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {step.assignedUser.name} · sequence {step.sequence}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
