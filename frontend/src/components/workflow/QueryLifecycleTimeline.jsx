import { CheckCircle2, CircleDot } from 'lucide-react';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/cn';
import { formatDate, formatTime } from '@/utils/dateTime';

const NODE_STYLES = {
  [STAGE_STATUS.COMPLETE]: 'bg-emerald-500 text-white border-emerald-600 shadow-2xs',
  [STAGE_STATUS.CURRENT]: 'bg-primary text-white border-primary shadow-2xs',
  [STAGE_STATUS.PENDING]: 'bg-slate-100 text-slate-400 border-slate-300',
};

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
                        <span
                          className={cn(
                            'h-0.5 flex-1',
                            index === 0
                              ? 'bg-transparent'
                              : stages[index - 1].status === STAGE_STATUS.COMPLETE
                                ? 'bg-emerald-400'
                                : 'bg-slate-200',
                          )}
                        />
                        <div
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                            NODE_STYLES[stage.status],
                          )}
                        >
                          <StageIcon status={stage.status} />
                        </div>
                        <span
                          className={cn(
                            'h-0.5 flex-1',
                            index === stages.length - 1
                              ? 'bg-transparent'
                              : stage.status === STAGE_STATUS.COMPLETE
                                ? 'bg-emerald-400'
                                : 'bg-slate-200',
                          )}
                        />
                      </div>

                      <p
                        className={cn(
                          'mt-2 px-1 text-[12.5px] font-bold leading-snug wrap-break-word',
                          stage.status === STAGE_STATUS.PENDING ? 'text-slate-400' : 'text-slate-800',
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
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                    NODE_STYLES[stage.status],
                  )}
                >
                  <StageIcon status={stage.status} />
                </div>
                {index < stages.length - 1 && (
                  <span
                    className={cn(
                      'my-1.5 min-h-6 w-0.5 flex-1',
                      stage.status === STAGE_STATUS.COMPLETE ? 'bg-emerald-400' : 'bg-slate-200',
                    )}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-3">
                <p
                  className={cn(
                    'text-[15px] font-bold',
                    stage.status === STAGE_STATUS.PENDING ? 'text-slate-400' : 'text-slate-800',
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
