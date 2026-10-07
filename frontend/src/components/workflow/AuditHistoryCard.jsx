import { useState } from 'react';
import {
  ArrowLeftRight,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Eye,
  Fingerprint,
  History,
  Forward,
  Inbox,
  Mail,
  PenLine,
  Send,
  ShieldCheck,
  Sparkles,
  Undo2,
  UserPlus,
  XCircle,
} from 'lucide-react';

import { CaseCard, CardAction, Pill, Segmented } from '@/components/common/CaseCard';
import { AUDIT_EVENT_LABELS } from '@/constants/statusEnums';
import { brandedName } from '@/constants/orgBranding';
import { stableKey } from '@/utils/stableKey';
import { cn } from '@/utils/cn';

const AUDIT_PREVIEW = 8;

const VIEWS = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'table', label: 'Table' },
];

const KINDS = [
  { test: /REJECT|FAIL/, Icon: XCircle, dot: 'bg-rose-50 text-rose-600 ring-rose-200', pill: 'danger' },
  { test: /CLOSED/, Icon: CheckCircle2, dot: 'bg-emerald-50 text-emerald-600 ring-emerald-200', pill: 'success' },
  { test: /REGISTERED|RECEIVED/, Icon: Inbox, dot: 'bg-emerald-50 text-emerald-600 ring-emerald-200', pill: 'success' },
  { test: /DISPATCH/, Icon: Send, dot: 'bg-sky-50 text-sky-600 ring-sky-200', pill: 'info' },
  { test: /ACKNOWLEDGEMENT|EMAIL/, Icon: Mail, dot: 'bg-sky-50 text-sky-600 ring-sky-200', pill: 'info' },
  { test: /APPROVAL/, Icon: BadgeCheck, dot: 'bg-indigo-50 text-indigo-600 ring-indigo-200', pill: 'info' },
  { test: /REVIEW|REVISION/, Icon: Eye, dot: 'bg-purple-50 text-purple-600 ring-purple-200', pill: 'ai' },
  { test: /AI_/, Icon: Sparkles, dot: 'bg-violet-50 text-violet-600 ring-violet-200', pill: 'ai' },
  { test: /DRAFT/, Icon: PenLine, dot: 'bg-violet-50 text-violet-600 ring-violet-200', pill: 'ai' },
  { test: /PULLED/, Icon: Undo2, dot: 'bg-amber-50 text-amber-700 ring-amber-200', pill: 'warning' },
  { test: /TRANSFER/, Icon: ArrowLeftRight, dot: 'bg-amber-50 text-amber-700 ring-amber-200', pill: 'warning' },
  { test: /FORWARD/, Icon: Forward, dot: 'bg-amber-50 text-amber-700 ring-amber-200', pill: 'warning' },
  { test: /ASSIGN/, Icon: UserPlus, dot: 'bg-amber-50 text-amber-700 ring-amber-200', pill: 'warning' },
];
const OTHER = { Icon: Circle, dot: 'bg-slate-50 text-slate-500 ring-slate-200', pill: 'neutral' };

const kindOf = (rawEvent) => KINDS.find(({ test }) => test.test(rawEvent)) || OTHER;

const titleCase = (code) => code.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function describeDetails(details) {
  if (!details) return '—';
  if (typeof details === 'string') return details;
  if (typeof details !== 'object') return String(details);

  const pairs = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);

  return pairs.length ? pairs.join(' · ') : '—';
}

function describe(entry) {
  const raw = String(entry.event || entry.action || '').toUpperCase();
  const at = entry.at ? new Date(entry.at) : null;
  return {
    title: AUDIT_EVENT_LABELS[raw] || (raw ? titleCase(raw) : '—'),
    actor: brandedName(entry.actor) || 'System',
    details: describeDetails(entry.details),
    date: at && at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: at && at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    kind: kindOf(raw),
  };
}

function TimelineItem({ entry, last }) {
  const event = describe(entry);
  const { Icon } = event.kind;
  return (
    <li className="relative flex gap-3 pb-1">
      {!last && <span className="absolute start-[15px] top-9 -bottom-1 w-px bg-slate-200" aria-hidden="true" />}
      <span
        className={cn('relative mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1', event.kind.dot)}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-50">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="m-0 text-[13.5px] font-semibold text-slate-900">{event.title}</p>
          {event.time && (
            <time dateTime={entry.at} className="text-[12px] tabular-nums text-slate-500">
              {event.time}
            </time>
          )}
        </div>
        <p className="m-0 text-[12px] font-medium text-slate-500">{event.actor}</p>
        <p className="m-0 mt-0.5 max-w-[80ch] text-[13px] leading-relaxed text-slate-700 wrap-break-word">{event.details}</p>
      </div>
    </li>
  );
}

/** Events in order, with the day written once above each day's events. */
function byDay(entries) {
  const days = [];
  for (const entry of entries) {
    const day = entry.at
      ? new Date(entry.at).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      : 'Undated';
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1).entries.push(entry);
  }
  return days;
}

function TableRow({ entry }) {
  const event = describe(entry);
  return (
    <tr className="transition-colors hover:bg-slate-50/60">
      <td className="px-3 py-2 align-top">
        <Pill tone={event.kind.pill}>{event.title}</Pill>
      </td>
      <td className="px-3 py-2 align-top text-[13px] font-medium whitespace-nowrap text-slate-700">{event.actor}</td>
      <td className="px-3 py-2 align-top text-[13px] leading-relaxed text-slate-700">{event.details}</td>
      <td className="px-3 py-2 text-end align-top text-[12px] whitespace-nowrap tabular-nums text-slate-500">
        {event.date} • {event.time}
      </td>
    </tr>
  );
}

/** The case's append-only trail as a regulatory activity timeline, newest first; a table on demand. */
export function AuditHistoryCard({ audit }) {
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState('timeline');

  const newestFirst = [...audit].reverse();
  const visible = showAll ? newestFirst : newestFirst.slice(0, AUDIT_PREVIEW);

  return (
    <CaseCard
      tone="history"
      banner
      art={[Fingerprint, History, ShieldCheck]}
      icon={ShieldCheck}
      title="Audit history"
      meta="Append-only trail, newest first."
      badge={<Pill tone="neutral">{audit.length} Total Events</Pill>}
      toolbar={
        <>
          <Segmented label="Audit history view" options={VIEWS} value={view} onChange={setView} />
          <span className="flex items-center gap-3">
            <span className="text-[12px] font-medium text-slate-500">
              Showing {visible.length} of {audit.length}
            </span>
            {audit.length > AUDIT_PREVIEW && (
              <CardAction onClick={() => setShowAll((shown) => !shown)}>
                {showAll ? 'Show recent only' : `Show all ${audit.length} events`}
              </CardAction>
            )}
          </span>
        </>
      }
    >
      {view === 'timeline' ? (
        <ol className="m-0 list-none p-0" aria-label="Audit events">
          {byDay(visible).flatMap(({ day, entries }) => [
            <li
              key={`day-${day}`}
              role="presentation"
              className="mb-2 flex items-center gap-2 pt-3 first:pt-0"
            >
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">{day}</span>
              <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              <span className="text-[11.5px] text-slate-400">
                {entries.length} {entries.length === 1 ? 'event' : 'events'}
              </span>
            </li>,
            ...entries.map((entry, index) => (
              <TimelineItem key={entry.auditId || stableKey(entry)} entry={entry} last={index === entries.length - 1} />
            )),
          ])}
        </ol>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50 text-[11.5px] font-semibold tracking-wider text-slate-500 uppercase">
                <th scope="col" className="px-3 py-2 text-start">Event</th>
                <th scope="col" className="px-3 py-2 text-start">Actor</th>
                <th scope="col" className="px-3 py-2 text-start">Details</th>
                <th scope="col" className="px-3 py-2 text-end">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((entry) => (
                <TableRow key={entry.auditId || stableKey(entry)} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CaseCard>
  );
}
