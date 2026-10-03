import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { findUserById } from '@/constants/mockUsers';
import { reviewLevelName } from '@/constants/queryLifecycle';
import { cycleOfStep } from '@/constants/reviewCycle';

const STATUS_VARIANT = {
  COMPLETED: 'status-green',
  IN_PROGRESS: 'status-blue',
  SUPERSEDED: 'status-amber',
};

function cyclesOf(steps) {
  const byCycle = new Map();
  for (const step of steps) {
    if (step.stepType !== 'REVIEW') continue;
    const cycle = cycleOfStep(step);
    byCycle.set(cycle, [...(byCycle.get(cycle) || []), step]);
  }
  return [...byCycle].sort((a, b) => a[0] - b[0]);
}

export function PreviousReviewCycles({ steps }) {
  const cycles = cyclesOf(steps || []);
  if (!cycles.length) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Previous review cycles</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Review chains closed by a pull back. Kept as history only — they no longer block a new chain.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {cycles.map(([cycle, chain]) => (
          <section key={cycle} aria-label={`Review cycle ${cycle + 1}`} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cycle {cycle + 1}
            </h3>
            {chain.map((step, index) => (
              <div
                key={step.stepId}
                className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{reviewLevelName(index)}</p>
                  <p className="text-xs text-muted-foreground">
                    {findUserById(step.assignedUserId)?.name || step.assignedUserId}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[step.status] || 'status-gray'}>
                  {step.status === 'SUPERSEDED' ? 'CLOSED BY PULL BACK' : step.status}
                </Badge>
              </div>
            ))}
          </section>
        ))}
      </CardBody>
    </Card>
  );
}
