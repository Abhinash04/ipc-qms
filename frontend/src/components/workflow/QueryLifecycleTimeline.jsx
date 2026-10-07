import { CheckCircle2, CircleDot } from 'lucide-react';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/cn';
import { formatDate, formatTime } from '@/utils/dateTime';

const NODE_STYLES = {
  [STAGE_STATUS.COMPLETE]: 'bg-emerald-500 text-white border-emerald-600 shadow-2xs',
  [STAGE_STATUS.CURRENT]: 'wf-current bg-primary text-white border-primary shadow-2xs',
  [STAGE_STATUS.PENDING]: 'bg-slate-100 text-slate-400 border-slate-300',
};

const STEP_MS = 70;
const delay = (position) => ({ '--wf-delay': `${Math.max(0, position) * STEP_MS}ms` });

function Segment({ filled, active = false, position, vertical = false, hidden = false, className }) {
  if (hidden) return <span className={cn(vertical ? 'w-0.5' : 'h-0.5', 'flex-1 bg-transparent', className)} />;
  return (
    <span
      className={cn(
        'relative flex-1 overflow-hidden rounded-full',
        vertical ? 'w-0.5' : 'h-0.5',
        active ? (vertical ? 'wf-march-y bg-primary-100' : 'wf-march-x bg-primary-100') : 'bg-slate-200',
        className,
      )}
      data-filled={filled || undefined}
      data-active={active || undefined}
    >
      {filled && (
        <span
          className={cn('absolute inset-0 overflow-hidden bg-emerald-400', vertical ? 'wf-fill-y' : 'wf-fill-x')}
          style={delay(position)}
        >
          <span className={cn('absolute inset-0', vertical ? 'wf-sweep-y' : 'wf-sweep-x')} style={delay(position)} />
        </span>
      )}
    </span>
  );
}

function CurrentRing() {
  return (
    <span
      className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-dashed border-primary/40 motion-safe:animate-[spin_8s_linear_infinite]"
      aria-hidden="true"
    />
  );
}

function StageIcon({ status, size = 'h-3.5 w-3.5' }) {
  if (status === STAGE_STATUS.COMPLETE) {
    return <CheckCircle2 className={size} strokeWidth={2.5} aria-hidden="true" />;
  }
  if (status === STAGE_STATUS.CURRENT) {
    return <CircleDot className={cn(size, 'animate-pulse')} strokeWidth={2.5} aria-hidden="true" />;
  }
  return <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />;
}

function actorLine(activity) {
  if (!activity) return null;
  if (activity.actor && activity.role) return `${activity.actor} — ${activity.role}`;
  return activity.actor || activity.role || null;
}

export function StageActivity({ stage }) {
  const activity = stage.activity;
  const rows = activity
    ? [
        ['Actor', actorLine(activity)],
        ['Action', activity.action],
        ['Version', activity.version],
        ['Date', activity.at ? formatDate(activity.at) : null],
        ['Time', activity.at ? formatTime(activity.at) : null],
      ].filter(([, value]) => value)
    : [['Action', 'No activity recorded yet']];

  return (
    <div className="space-y-1 text-left">
      <p className="text-[12.5px] font-bold">{stage.label}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="opacity-70">{term}:</dt>
            <dd className="m-0 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function InlineActivity({ activity }) {
  if (!activity || activity.pending) return null;
  return (
    <p className="mt-1 text-[12.5px] text-slate-500">
      {[actorLine(activity), activity.action, activity.version, activity.at ? `${formatDate(activity.at)}, ${formatTime(activity.at)}` : null]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}

export function QueryLifecycleTimeline({ stages = [] }) {
  if (stages.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="@container min-w-0 select-none">
        <div
          className="hidden @2xl:block overflow-x-auto overscroll-x-contain"
          tabIndex={0}
          role="group"
          aria-label="Workflow progress"
        >
          <ol className="flex items-start gap-0">
            {stages.map((stage, index) => (
              <li
                key={stage.key}
                className="flex min-w-28 max-w-40 flex-1 flex-col items-center text-center"
                aria-current={stage.status === STAGE_STATUS.CURRENT ? 'step' : undefined}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      tabIndex={0}
                      data-stage-trigger={stage.key}
                      className="flex w-full cursor-default flex-col items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <div className="flex w-full items-center">
                        <Segment
                          hidden={index === 0}
                          filled={index > 0 && stages[index - 1].status === STAGE_STATUS.COMPLETE}
                          position={2 * index - 1}
                        />
                        <div
                          className={cn(
                            'wf-node relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
                            NODE_STYLES[stage.status],
                          )}
                          style={delay(2 * index)}
                        >
                          {stage.status === STAGE_STATUS.CURRENT && <CurrentRing />}
                          <StageIcon status={stage.status} />
                        </div>
                        <Segment
                          hidden={index === stages.length - 1}
                          filled={stage.status === STAGE_STATUS.COMPLETE}
                          active={stage.status === STAGE_STATUS.CURRENT}
                          position={2 * index}
                        />
                      </div>

                      <p
                        className={cn(
                          'mt-2 px-1 text-[12.5px] font-bold leading-snug wrap-break-word transition-colors duration-500',
                          stage.status === STAGE_STATUS.PENDING
                            ? 'text-slate-400'
                            : stage.status === STAGE_STATUS.CURRENT
                              ? 'text-primary-700'
                              : 'text-slate-800',
                        )}
                      >
                        {stage.label}
                      </p>
                      {stage.actor && (
                        <p className="px-1 text-[11.5px] font-medium text-slate-400 wrap-break-word">
                          {stage.actor}
                        </p>
                      )}
                      {stage.status === STAGE_STATUS.CURRENT && stage.note && (
                        <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                          {stage.note}
                        </p>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6} className="block max-w-72 px-3 py-2">
                    <StageActivity stage={stage} />
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ol>
        </div>

        <ol className="space-y-4 @2xl:hidden">
          {stages.map((stage, index) => (
            <li
              key={stage.key}
              className="flex gap-4"
              aria-current={stage.status === STAGE_STATUS.CURRENT ? 'step' : undefined}
            >
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'wf-node relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
                    NODE_STYLES[stage.status],
                  )}
                  style={delay(2 * index)}
                >
                  {stage.status === STAGE_STATUS.CURRENT && <CurrentRing />}
                  <StageIcon status={stage.status} />
                </div>
                {index < stages.length - 1 && (
                  <Segment
                    vertical
                    filled={stage.status === STAGE_STATUS.COMPLETE}
                    active={stage.status === STAGE_STATUS.CURRENT}
                    position={2 * index}
                    className="my-1.5 min-h-6"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-3">
                <p
                  className={cn(
                    'text-[15px] font-bold transition-colors duration-500',
                    stage.status === STAGE_STATUS.PENDING
                      ? 'text-slate-400'
                      : stage.status === STAGE_STATUS.CURRENT
                        ? 'text-primary-700'
                        : 'text-slate-800',
                  )}
                >
                  {stage.label}
                </p>
                {stage.actor && (
                  <p className="mt-0.5 text-[13.5px] font-medium text-slate-400">{stage.actor}</p>
                )}
                <InlineActivity activity={stage.activity} />
                {stage.status === STAGE_STATUS.CURRENT && stage.note && (
                  <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-900">
                    {stage.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </TooltipProvider>
  );
}
