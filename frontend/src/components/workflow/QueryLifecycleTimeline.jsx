import { CheckCircle2, CircleDot } from 'lucide-react';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { cn } from '@/utils/cn';

const NODE_STYLES = {
  [STAGE_STATUS.COMPLETE]: 'bg-emerald-500 text-white border-emerald-600 shadow-2xs',
  [STAGE_STATUS.CURRENT]: 'bg-blue-600 text-white border-blue-700 shadow-2xs',
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

export function QueryLifecycleTimeline({ stages = [] }) {
  if (stages.length === 0) return null;

  return (
    <div className="select-none">
      <div className="hidden lg:block overflow-x-auto">
        <ol className="flex min-w-max items-start gap-0">
          {stages.map((stage, index) => (
            <li
              key={stage.key}
              className="flex min-w-28 max-w-40 flex-1 flex-col items-center text-center"
              aria-current={stage.status === STAGE_STATUS.CURRENT ? 'step' : undefined}
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
                  'mt-2 px-1 text-[12.5px] font-bold leading-snug',
                  stage.status === STAGE_STATUS.PENDING ? 'text-slate-400' : 'text-slate-800',
                )}
              >
                {stage.label}
              </p>
              {stage.actor && (
                <p className="px-1 text-[11.5px] font-medium text-slate-400">{stage.actor}</p>
              )}
              {stage.status === STAGE_STATUS.CURRENT && stage.note && (
                <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                  {stage.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      <ol className="space-y-4 lg:hidden">
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
                  'text-[15px] font-black',
                  stage.status === STAGE_STATUS.PENDING ? 'text-slate-400' : 'text-slate-800',
                )}
              >
                {stage.label}
              </p>
              {stage.actor && (
                <p className="mt-0.5 text-[13.5px] font-medium text-slate-400">{stage.actor}</p>
              )}
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
  );
}
