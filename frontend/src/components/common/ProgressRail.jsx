import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKFLOW_STAGES as STAGES, STAGE_INDEX } from '@/constants';

export function ProgressRail({ status }) {
  const current = STAGE_INDEX[status] ?? 0;

  return (
    <div className="overflow-x-auto rounded-lg border bg-card px-4 py-4">
      <ol className="flex items-start min-w-150">
        {STAGES.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} aria-current={active ? 'step' : undefined} className={cn('flex items-center', i < STAGES.length - 1 ? 'flex-1' : 'flex-none')}>
              <div className="flex flex-col items-center gap-1.5 shrink-0 w-23">
                <span
                  className={cn(
                    'grid place-content-center h-7 w-7 rounded-full border transition-colors',
                    done && 'bg-status-green-fg border-status-green-fg text-white',
                    active && 'border-primary bg-primary/10 text-primary',
                    !done && !active && 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : active ? (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping motion-reduce:hidden" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                  )}
                </span>
                <span className={cn('text-[11px] text-center leading-tight', active ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                  {label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <span className={cn('h-0.5 flex-1 mx-1 -mt-5 rounded', done ? 'bg-status-green-fg' : 'bg-border')} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
