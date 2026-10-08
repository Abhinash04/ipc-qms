import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Bot, CheckCircle2, CircleDot, MessageSquareWarning, Undo2 } from 'lucide-react';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { WORKFLOW_ITEM, WORKFLOW_VIEW, buildWorkflowSequence, selectWorkflowView } from '@/constants/workflowSequence';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/cn';
import { formatDate, formatTime } from '@/utils/dateTime';

const NODE_STYLES = {
  [STAGE_STATUS.COMPLETE]: 'bg-emerald-500 text-white border-emerald-600 shadow-2xs',
  [STAGE_STATUS.CURRENT]: 'wf-current bg-primary text-white border-primary shadow-2xs',
  [STAGE_STATUS.PENDING]: 'bg-slate-100 text-slate-400 border-slate-300',
};

const EVENT_STYLES = {
  [WORKFLOW_ITEM.TRANSFER]: {
    title: 'Transfer',
    pill: 'Transfer',
    Icon: ArrowLeftRight,
    node: 'bg-sky-500 border-sky-600 text-white',
    badge: 'bg-sky-100 text-sky-900 ring-sky-200',
  },
  [WORKFLOW_ITEM.AUTOMATIC_TRANSFER]: {
    title: 'Automatic transfer',
    pill: 'Auto transfer',
    Icon: Bot,
    node: 'bg-indigo-500 border-indigo-600 text-white',
    badge: 'bg-indigo-100 text-indigo-900 ring-indigo-200',
  },
  [WORKFLOW_ITEM.PULL_BACK]: {
    title: 'Pull back',
    pill: 'Pull back',
    Icon: Undo2,
    node: 'bg-amber-500 border-amber-600 text-white',
    badge: 'bg-amber-100 text-amber-900 ring-amber-200',
  },
  [WORKFLOW_ITEM.CHANGES_REQUESTED]: {
    title: 'Changes requested',
    pill: 'Changes requested',
    Icon: MessageSquareWarning,
    node: 'bg-rose-500 border-rose-600 text-white',
    badge: 'bg-rose-100 text-rose-900 ring-rose-200',
  },
};

// A send-back at final approval can be a rejection rather than a request for changes.
const REJECTED_STYLE = { title: 'Rejected at final approval', pill: 'Rejected' };

const styleOf = (item) => {
  const style = EVENT_STYLES[item.kind];
  return item.event?.rejected ? { ...style, ...REJECTED_STYLE } : style;
};

const NONE = [];

const STEP_MS = 70;
const delay = (position) => ({ '--wf-delay': `${Math.max(0, position) * STEP_MS}ms` });

// Return arcs rise above the line; each arc that overlaps an earlier one rises one step higher.
const ARC_RISE = 32;
const ARC_STEP = 16;
const riseOf = (level) => ARC_RISE + (level - 1) * ARC_STEP;

const isStage = (item) => item.kind === WORKFLOW_ITEM.STAGE;
const isGap = (item) => item.kind === WORKFLOW_ITEM.GAP;
const isDone = (item) => (isGap(item) ? item.done : !isStage(item) || item.status === STAGE_STATUS.COMPLETE);
const skippedLabel = (count) => `${count} ${count === 1 ? 'stage' : 'stages'}`;

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

const personLine = (party) => [...new Set([party?.name, party?.role].filter(Boolean))].join(' — ');
const partyLine = (party) => [party?.stage, personLine(party)].filter(Boolean).join(' · ') || null;
const placeOf = (party) => party?.stage || party?.name || null;
const when = (at) => (at ? `${formatDate(at)}, ${formatTime(at)}` : null);

const destinationOf = (item) => (item.kind === WORKFLOW_ITEM.PULL_BACK ? item.returnsTo : null) || placeOf(item.event.to);

function eventLabel(item) {
  const { event } = item;
  const from = placeOf(event.from);
  const to = placeOf(event.to);
  const details = [
    [from && `from ${from}`, to && `to ${to}`].filter(Boolean).join(' '),
    personLine(event.by) && `by ${personLine(event.by)}`,
    when(event.at),
  ].filter(Boolean);
  const label = [styleOf(item).title, details.join(', ')].filter(Boolean).join(': ');
  return event.reason ? `${label}. Reason: ${event.reason}` : label;
}

function EventDetails({ item, showTitle = true }) {
  const { event } = item;
  const rows = [
    ['From', partyLine(event.from)],
    ['To', partyLine(event.to)],
    ['By', personLine(event.by)],
    ['When', when(event.at)],
    ['Reason', event.reason],
    ['Remarks', event.remarks],
  ].filter(([, value]) => value);

  return (
    <div className="space-y-1 text-left">
      {showTitle && <p className="text-[12.5px] font-bold">{styleOf(item).title}</p>}
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

function EventPill({ item }) {
  const style = styleOf(item);
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ring-1', style.badge)}>
      {style.pill}
    </span>
  );
}

function EventNode({ kind, position, size = 'h-6 w-6', nodeRef }) {
  const style = EVENT_STYLES[kind];
  return (
    <span
      ref={nodeRef}
      className={cn('wf-node relative flex shrink-0 items-center justify-center rounded-full border shadow-2xs', size, style.node)}
      style={delay(position)}
    >
      <style.Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}

/** Hover or focus shows the details, as for stages; a click shows them too and keeps them open. */
function EventTooltip({ item, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={eventLabel(item)}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          className="flex w-full cursor-pointer flex-col items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="block max-w-80 px-3 py-2">
        <EventDetails item={item} />
      </TooltipContent>
    </Tooltip>
  );
}

const stageTextTone = (status) =>
  status === STAGE_STATUS.PENDING ? 'text-slate-400' : status === STAGE_STATUS.CURRENT ? 'text-primary-700' : 'text-slate-800';

function TrackStage({ item, index, items, nodeRef }) {
  const { stage, status } = item;
  return (
    <li
      className="flex min-w-28 max-w-40 flex-1 flex-col items-center text-center"
      aria-current={status === STAGE_STATUS.CURRENT ? 'step' : undefined}
      data-workflow-item={WORKFLOW_ITEM.STAGE}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            data-stage-trigger={stage.key}
            className="flex w-full cursor-default flex-col items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <div className="flex w-full items-center">
              <Segment hidden={index === 0} filled={index > 0 && isDone(items[index - 1])} position={2 * index - 1} />
              <div
                ref={nodeRef}
                className={cn(
                  'wf-node relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
                  NODE_STYLES[status],
                )}
                style={delay(2 * index)}
              >
                {status === STAGE_STATUS.CURRENT && <CurrentRing />}
                <StageIcon status={status} />
              </div>
              <Segment
                hidden={index === items.length - 1}
                filled={status === STAGE_STATUS.COMPLETE}
                active={status === STAGE_STATUS.CURRENT}
                position={2 * index}
              />
            </div>

            <p
              className={cn(
                'mt-2 max-w-full px-1 text-[12.5px] font-bold leading-snug wrap-break-word transition-colors duration-500',
                stageTextTone(status),
              )}
            >
              {stage.label}
            </p>
            {/* max-w-full: as a centred flex item the line would otherwise size to an unbroken word
                such as an email address and spill into the next column instead of wrapping. */}
            {stage.actor && <p className="max-w-full px-1 text-[11.5px] font-medium text-slate-400 wrap-break-word">{stage.actor}</p>}
            {status === STAGE_STATUS.CURRENT && stage.note && (
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
  );
}

function TrackEvent({ item, index, items, nodeRef }) {
  const destination = destinationOf(item);
  return (
    <li
      className={cn(
        'flex shrink-0 flex-col items-center text-center',
        // "Changes requested" is the longest pill; it needs a wider column to clear its neighbours.
        item.kind === WORKFLOW_ITEM.CHANGES_REQUESTED ? 'w-36' : 'w-24',
      )}
      data-workflow-item={item.kind}
    >
      <EventTooltip item={item}>
        <span className="flex h-7 w-full items-center">
          <Segment hidden={index === 0} filled={index > 0 && isDone(items[index - 1])} position={2 * index - 1} />
          <EventNode kind={item.kind} position={2 * index} nodeRef={nodeRef} />
          <Segment hidden={index === items.length - 1} filled position={2 * index} />
        </span>
        <span className="mt-2">
          <EventPill item={item} />
        </span>
        {destination && (
          <span className="mt-1 line-clamp-2 max-w-full px-1 text-[11px] leading-snug text-slate-500 wrap-break-word">
            <span className="rtl:inline-block rtl:rotate-180" aria-hidden="true">
              →
            </span>{' '}
            {destination}
          </span>
        )}
      </EventTooltip>
    </li>
  );
}

/** Stages a filtered view leaves out: a dashed stretch of line with how many were skipped. */
function TrackGap({ item }) {
  return (
    <li className="flex w-16 shrink-0 flex-col items-center text-center" data-workflow-item={WORKFLOW_ITEM.GAP}>
      <span className="flex h-7 w-full items-center" aria-hidden="true">
        <span className={cn('h-0 flex-1 border-t-2 border-dashed', item.done ? 'border-emerald-300' : 'border-slate-300')} />
      </span>
      <span className="mt-2 text-[11px] font-medium text-slate-400">
        {skippedLabel(item.hidden)}
        <span className="sr-only"> not shown</span>
      </span>
    </li>
  );
}

/** One arc per pull back, from its marker back over the line to the visit it returned to. */
function ReturnArcs({ arcs, markerId }) {
  if (arcs.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true" focusable="false">
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="0" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 1.5 L8 5 L0 8.5 Z" fill="#FF7300" />
        </marker>
      </defs>
      {arcs.map((arc) => {
        const base = Math.min(arc.y1, arc.y2);
        const control = base - (riseOf(arc.level) * 4) / 3;
        return (
          <path
            key={arc.id}
            data-return-arc={arc.id}
            d={`M ${arc.x1} ${arc.y1} C ${arc.x1} ${control}, ${arc.x2} ${control}, ${arc.x2} ${arc.y2 - 8}`}
            fill="none"
            stroke="#FF7300"
            strokeWidth="2.2"
            strokeDasharray="6 4"
            strokeLinecap="butt"
            className="wf-arc"
            style={delay(2 * arc.position)}
            markerEnd={`url(#${markerId})`}
          />
        );
      })}
    </svg>
  );
}

/** Each arc's height step: one above every earlier arc whose span it overlaps. */
function arcLevels(connections, items) {
  const position = new Map(items.map((item, index) => [item.id, index]));
  const placed = [];
  return connections.map((connection) => {
    const [from, to] = [position.get(connection.from), position.get(connection.to)];
    const [low, high] = [Math.min(from, to), Math.max(from, to)];
    const level = 1 + placed.filter((other) => other.low <= high && low <= other.high).reduce((top, other) => Math.max(top, other.level), 0);
    placed.push({ low, high, level });
    return { ...connection, level, position: from };
  });
}

function useReturnArcs(connections, trackRef, nodesRef) {
  const [arcs, setArcs] = useState([]);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const nodes = nodesRef.current;
    const measure = () => {
      const box = track?.getBoundingClientRect();
      const next = box
        ? connections
          .map((connection) => {
            const from = nodes.get(connection.from)?.getBoundingClientRect();
            const to = nodes.get(connection.to)?.getBoundingClientRect();
            if (!from || !to || (!from.width && !to.width)) return null;
            return {
              id: connection.id,
              level: connection.level,
              position: connection.position,
              x1: from.left + from.width / 2 - box.left,
              y1: from.top - box.top,
              x2: to.left + to.width / 2 - box.left,
              y2: to.top - box.top,
            };
          })
          .filter(Boolean)
        : [];
      setArcs((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    measure();
    if (!track || connections.length === 0 || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [connections, trackRef, nodesRef]);
  return arcs;
}

function VerticalItem({ item, index, items }) {
  const last = index === items.length - 1;
  if (isGap(item)) {
    return (
      <li className="flex gap-4" data-workflow-item={WORKFLOW_ITEM.GAP}>
        <div className="flex w-6 flex-col items-center" aria-hidden="true">
          <span className={cn('min-h-8 flex-1 border-s-2 border-dashed', item.done ? 'border-emerald-300' : 'border-slate-300')} />
        </div>
        <p className="m-0 self-center text-[12.5px] font-medium text-slate-400">{skippedLabel(item.hidden)} not shown</p>
      </li>
    );
  }
  const stage = isStage(item) ? item.stage : null;
  return (
    <li
      className="flex gap-4"
      aria-current={item.status === STAGE_STATUS.CURRENT ? 'step' : undefined}
      data-workflow-item={item.kind}
    >
      <div className="flex flex-col items-center">
        {stage ? (
          <div
            className={cn(
              'wf-node relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
              NODE_STYLES[item.status],
            )}
            style={delay(2 * index)}
          >
            {item.status === STAGE_STATUS.CURRENT && <CurrentRing />}
            <StageIcon status={item.status} />
          </div>
        ) : (
          <EventNode kind={item.kind} position={2 * index} />
        )}
        {!last && (
          <Segment
            vertical
            filled={isDone(item)}
            active={item.status === STAGE_STATUS.CURRENT}
            position={2 * index}
            className="my-1.5 min-h-6"
          />
        )}
      </div>

      {stage ? (
        <div className="min-w-0 flex-1 pb-3">
          <p className={cn('text-[15px] font-bold transition-colors duration-500', stageTextTone(item.status))}>{stage.label}</p>
          {stage.actor && <p className="mt-0.5 text-[13.5px] font-medium text-slate-400 wrap-break-word">{stage.actor}</p>}
          <InlineActivity activity={stage.activity} />
          {item.status === STAGE_STATUS.CURRENT && stage.note && (
            <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-900">
              {stage.note}
            </p>
          )}
        </div>
      ) : (
        <div className="min-w-0 flex-1 pb-3" aria-label={eventLabel(item)} role="group">
          <EventPill item={item} />
          {item.kind === WORKFLOW_ITEM.PULL_BACK && item.returnsTo && (
            <p className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-amber-900">
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Returned to {item.returnsTo}
            </p>
          )}
          <div className="mt-1 text-slate-600">
            <EventDetails item={item} showTitle={false} />
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The case's whole history on one line, oldest to newest: the lifecycle stages with every transfer,
 * pull back and change request where it happened. A pull back draws an arc back to the stage it returned to, and
 * the line carries on from that stage again. Without `events` it is the plain lifecycle.
 * `view` only chooses what is drawn from that one sequence (see WORKFLOW_VIEW).
 */
export function QueryLifecycleTimeline({ stages = NONE, events = NONE, audit = NONE, view = WORKFLOW_VIEW.ALL }) {
  const sequence = useMemo(() => buildWorkflowSequence({ stages, events, audit }), [stages, events, audit]);
  const { items, connections } = useMemo(() => selectWorkflowView(sequence, stages, view), [sequence, stages, view]);
  const leveled = useMemo(() => arcLevels(connections, items), [connections, items]);
  const trackRef = useRef(null);
  const nodesRef = useRef(new Map());
  const arcs = useReturnArcs(leveled, trackRef, nodesRef);
  const markerId = `pullback-arrowhead-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  if (stages.length === 0) return null;
  if (items.length === 0) {
    return (
      <p className="m-0 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-[13px] font-medium text-slate-500">
        No pull backs, transfers or change requests recorded.
      </p>
    );
  }

  const lane = leveled.length ? riseOf(Math.max(...leveled.map((connection) => connection.level))) + 18 : 0;
  const nodeRef = (id) => (element) => {
    if (element) nodesRef.current.set(id, element);
    else nodesRef.current.delete(id);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="@container min-w-0 select-none">
        <div
          className="hidden @2xl:block overflow-x-auto overscroll-x-contain"
          tabIndex={0}
          role="group"
          aria-label="Workflow progress"
        >
          <div ref={trackRef} className="relative" style={lane ? { paddingTop: lane } : undefined}>
            <ReturnArcs arcs={arcs} markerId={markerId} />
            {arcs.map((arc) => {
              const base = Math.min(arc.y1, arc.y2);
              const midX = (arc.x1 + arc.x2) / 2;
              const midY = base - riseOf(arc.level);
              return (
                <div
                  key={`arc-badge-${arc.id}`}
                  data-arc-badge={arc.id}
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 select-none"
                  style={{ left: `${midX}px`, top: `${midY}px`, ...delay(2 * arc.position) }}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD0A6] bg-[#FFF5EA] px-3 py-1 shadow-xs ring-2 ring-orange-200/40 backdrop-blur-xs">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#FF7300] text-white shadow-2xs">
                      <ArrowLeft className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
                    </span>
                    <span className="text-[12px] font-extrabold tracking-tight text-[#FF7300] whitespace-nowrap">
                      Pull back
                    </span>
                  </span>
                </div>
              );
            })}
            <ol className="relative flex items-stretch gap-0">
              {items.map((item, index) =>
                isGap(item) ? (
                  <TrackGap key={item.id} item={item} />
                ) : isStage(item) ? (
                  <TrackStage key={item.id} item={item} index={index} items={items} nodeRef={nodeRef(item.id)} />
                ) : (
                  <TrackEvent key={item.id} item={item} index={index} items={items} nodeRef={nodeRef(item.id)} />
                ),
              )}
            </ol>
          </div>
        </div>

        <ol className="space-y-4 @2xl:hidden">
          {items.map((item, index) => (
            <VerticalItem key={item.id} item={item} index={index} items={items} />
          ))}
        </ol>
      </div>
    </TooltipProvider>
  );
}
