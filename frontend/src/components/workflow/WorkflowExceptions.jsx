import { ArrowLeftRight, Bot, Undo2 } from 'lucide-react';
import { SPECIAL_EVENT } from '@/constants/workflowExceptions';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/cn';
import { formatDate, formatTime } from '@/utils/dateTime';

const KINDS = {
  [SPECIAL_EVENT.PULL_BACK]: {
    label: 'Pull back',
    Icon: Undo2,
    node: 'bg-amber-500 border-amber-600 text-white',
    badge: 'bg-amber-100 text-amber-900 ring-amber-200',
    ping: 'bg-amber-400',
  },
  [SPECIAL_EVENT.TRANSFER_QUERY]: {
    label: 'Transfer',
    Icon: ArrowLeftRight,
    node: 'bg-sky-500 border-sky-600 text-white',
    badge: 'bg-sky-100 text-sky-900 ring-sky-200',
    ping: 'bg-sky-400',
  },
};

const AUTOMATIC = {
  label: 'Automatic transfer',
  Icon: Bot,
  node: 'bg-indigo-500 border-indigo-600 text-white',
  badge: 'bg-indigo-100 text-indigo-900 ring-indigo-200',
  ping: 'bg-indigo-400',
};

const kindOf = (event) => (event.automatic ? AUTOMATIC : KINDS[event.type]);

const STEP_MS = 70;
const delay = (position) => ({ '--wf-delay': `${Math.max(0, position) * STEP_MS}ms` });

const personLine = (party) => [party?.name, party?.role].filter(Boolean).join(' — ');
const placeOf = (party) => party?.stage || party?.name || '—';
const when = (at) => (at ? `${formatDate(at)}, ${formatTime(at)}` : null);

function Connector({ position, vertical = false, hidden = false, className }) {
  if (hidden) return <span className={cn(vertical ? 'w-0.5' : 'h-0.5', 'flex-1 bg-transparent', className)} />;
  return (
    <span className={cn('relative flex-1 overflow-hidden rounded-full bg-slate-200', vertical ? 'w-0.5' : 'h-0.5', className)}>
      <span
        className={cn('absolute inset-0 overflow-hidden bg-slate-400', vertical ? 'wf-fill-y' : 'wf-fill-x')}
        style={delay(position)}
      >
        <span className={cn('absolute inset-0', vertical ? 'wf-sweep-y' : 'wf-sweep-x')} style={delay(position)} />
      </span>
    </span>
  );
}

function EventNode({ event, latest, position, size = 'h-8 w-8' }) {
  const kind = kindOf(event);
  return (
    <span className={cn('wf-node relative flex shrink-0', size)} style={delay(position)}>
      {latest && (
        <span
          className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', kind.ping)}
          aria-hidden="true"
        />
      )}
      <span className={cn('relative flex h-full w-full items-center justify-center rounded-full border', kind.node)}>
        <kind.Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </span>
  );
}

function EventDetails({ event, showTitle = true }) {
  const rows = [
    ['From', personLine(event.from) ? [event.from?.stage, personLine(event.from)].filter(Boolean).join(' · ') : event.from?.stage],
    ['To', personLine(event.to) ? [event.to?.stage, personLine(event.to)].filter(Boolean).join(' · ') : event.to?.stage],
    ['By', personLine(event.by)],
    ['When', when(event.at)],
    ['Reason', event.reason],
    ['Remarks', event.remarks],
  ].filter(([, value]) => value);

  return (
    <div className="space-y-1 text-left">
      {showTitle && <p className="text-[12.5px] font-bold">{kindOf(event).label}</p>}
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

function Badge({ event, latest }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1">
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold ring-1', kindOf(event).badge)}>
        {kindOf(event).label}
      </span>
      {latest && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">Most recent</span>}
    </span>
  );
}

export function WorkflowExceptions({ events = [] }) {
  if (events.length === 0) return null;

  const line = [...events].reverse();
  const lastIndex = line.length - 1;

  return (
    <section aria-labelledby="workflow-exceptions-heading" className="mt-5 border-t border-dashed border-slate-200 pt-4">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="workflow-exceptions-heading" className="m-0 text-[14px] font-bold text-slate-900">
          Pull backs &amp; transfers
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{events.length}</span>
        <span className="text-[12px] text-slate-500">Outside the normal workflow, oldest to newest</span>
        <span className="ms-auto flex items-center gap-3 text-[11.5px] text-slate-500" aria-hidden="true">
          {[KINDS[SPECIAL_EVENT.PULL_BACK], KINDS[SPECIAL_EVENT.TRANSFER_QUERY], AUTOMATIC].map((kind) => (
            <span key={kind.label} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2.5 w-2.5 rounded-full', kind.node)} />
              {kind.label}
            </span>
          ))}
        </span>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="@container min-w-0">
          <div
            className="hidden overflow-x-auto overscroll-x-contain pb-1 @2xl:block"
            tabIndex={0}
            role="group"
            aria-label="Pull back and transfer history"
          >
            <ol className="flex items-start">
              {line.map((event, index) => (
                <li
                  key={event.id}
                  className="flex min-w-40 max-w-56 flex-1 flex-col items-center text-center"
                  data-special-event={event.type}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        className="flex w-full cursor-default flex-col items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        <div className="flex w-full items-center">
                          <Connector hidden={index === 0} position={2 * index - 1} />
                          <EventNode event={event} latest={index === lastIndex} position={2 * index} />
                          <Connector hidden={index === lastIndex} position={2 * index} />
                        </div>

                        <div className="wf-rise mt-2 space-y-1 px-1.5" style={delay(2 * index)}>
                          <Badge event={event} latest={index === lastIndex} />
                          {event.at && (
                            <time dateTime={event.at} className="block text-[11.5px] font-medium tabular-nums text-slate-500">
                              {when(event.at)}
                            </time>
                          )}
                          <p className="m-0 text-[12px] font-semibold leading-snug text-slate-800 wrap-break-word">
                            {placeOf(event.from)} <span className="text-slate-400 rtl:inline-block rtl:rotate-180">→</span>{' '}
                            {placeOf(event.to)}
                          </p>
                          {event.by && (
                            <p className="m-0 text-[11.5px] text-slate-500 wrap-break-word">By {personLine(event.by)}</p>
                          )}
                          {event.reason && (
                            <p className="m-0 line-clamp-2 text-[11.5px] italic text-slate-500 wrap-break-word">
                              “{event.reason}”
                            </p>
                          )}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6} className="block max-w-80 px-3 py-2">
                      <EventDetails event={event} />
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ol>
          </div>

          <ol className="space-y-1 @2xl:hidden">
            {line.map((event, index) => (
              <li key={event.id} className="flex gap-3" data-special-event={event.type}>
                <div className="flex flex-col items-center">
                  <EventNode event={event} latest={index === lastIndex} position={2 * index} size="h-7 w-7" />
                  {index < lastIndex && <Connector vertical position={2 * index} className="my-1.5 min-h-6" />}
                </div>
                <div className="min-w-0 flex-1 pb-3">
                  <Badge event={event} latest={index === lastIndex} />
                  <div className="mt-1">
                    <EventDetails event={event} showTitle={false} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </TooltipProvider>
    </section>
  );
}
