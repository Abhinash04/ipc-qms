import { useState } from 'react';
import { ChevronRight, AlertTriangle, ShieldOff, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils/cn';
import { stableKey } from '@/utils/stableKey';
import { formatTime, humaniseAction } from './auditFormat';

const RESULT_STYLE = {
  success: { icon: CheckCircle2, className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failure: { icon: AlertTriangle, className: 'text-rose-700 bg-rose-50 border-rose-200' },
  denied: { icon: ShieldOff, className: 'text-amber-700 bg-amber-50 border-amber-200' },
};

const ACTOR_LABEL = { human: 'User', agent: 'AI agent', system: 'System' };

function ResultChip({ result }) {
  const style = RESULT_STYLE[result] || RESULT_STYLE.success;
  const Icon = style.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize',
        style.className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {result || 'success'}
    </span>
  );
}

const plainValue = (value) =>
  value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);

function DetailRow({ event }) {
  const view = event.view;
  if (view) {
    return (
      <tr className="border-b border-slate-100 bg-slate-50/60">
        <td />
        <td colSpan={7} className="px-3 pb-3 pt-0 text-[12px] text-slate-700">
          {view.details && <p className="m-0">{view.details}</p>}
          {event.changes && (
            <p className="m-0 mt-1">
              <span className="font-bold text-slate-500">Previous value: </span>
              {view.previousValue}
              <span aria-hidden="true" className="mx-1.5 font-bold text-primary-700">→</span>
              <span className="font-bold text-slate-500">New value: </span>
              {view.newValue}
            </p>
          )}
          {view.failureReason && !view.details?.includes(view.failureReason) && (
            <p className="m-0 mt-1">
              <span className="font-bold text-slate-500">Failure reason: </span>
              {view.failureReason}
            </p>
          )}
          <p className="m-0 mt-1 text-[11.5px] text-slate-500">
            {[
              view.section && `Section: ${view.section}`,
              view.sessionId && `Login session ${view.sessionId}`,
              view.device && `Browser: ${view.device}`,
              view.module && `Module: ${view.module}`,
              view.logSource && `Server: ${view.logSource}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100 bg-slate-50/60">
      <td />
      <td colSpan={7} className="px-3 pb-3 pt-0">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
          {event.error && (
            <div className="sm:col-span-2">
              <dt className="inline font-bold text-rose-700">Error: </dt>
              <dd className="inline text-rose-700">{event.error}</dd>
            </div>
          )}
          {event.messageId && (
            <div>
              <dt className="inline font-bold text-slate-500">Message: </dt>
              <dd className="inline font-mono text-slate-700">{event.messageId}</dd>
            </div>
          )}
          {event.attachmentId && (
            <div>
              <dt className="inline font-bold text-slate-500">Attachment: </dt>
              <dd className="inline font-mono text-slate-700">{event.attachmentId}</dd>
            </div>
          )}
          {event.aiMetadata &&
            Object.entries(event.aiMetadata).map(([key, value]) => (
              <div key={key}>
                <dt className="inline font-bold text-slate-500">{key}: </dt>
                <dd className="inline text-slate-700">{plainValue(value)}</dd>
              </div>
            ))}
          {event.details &&
            Object.entries(event.details).map(([key, value]) => (
              <div key={key}>
                <dt className="inline font-bold text-slate-500">{key}: </dt>
                <dd className="inline break-all text-slate-700">{plainValue(value)}</dd>
              </div>
            ))}
        </dl>
      </td>
    </tr>
  );
}

// Shown on events recorded before audit IDs were given out, or by a copy that does not give them.
const NOT_ISSUED_HINT =
  'This activity was recorded before audit IDs were given out, or by a copy of the application that does not give audit IDs.';

/** Name, role and user ID of whoever did it. */
function UserCell({ event }) {
  const card = event.view?.userCard;
  if (!card) return <span className="text-slate-700">{ACTOR_LABEL[event.actorType] || event.actorType}</span>;
  return (
    <>
      <span className="block font-bold text-slate-800">{card.name}</span>
      {card.role && <span className="block text-slate-600">{card.role}</span>}
      {card.id && <span className="block font-mono text-[11px] text-slate-400">ID: {card.id}</span>}
    </>
  );
}

function Row({ event, onOpenQuery }) {
  const [open, setOpen] = useState(false);
  const view = event.view;
  const hasDetail = Boolean(event.details || event.error || event.aiMetadata || view?.device || view?.sessionId || event.changes);

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/70">
        <td className="px-3 py-2.5 align-middle">
          {hasDetail ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} details for ${humaniseAction(event.action)}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="block h-6 w-6" />
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px] text-slate-500">
          {view?.auditId && view.auditId !== '-' ? (
            view.auditId
          ) : (
            <span className="font-sans text-slate-400" title={NOT_ISSUED_HINT}>
              Not issued
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] tabular-nums text-slate-600">
          {formatTime(event.timestamp)}
        </td>
        <td className="px-3 py-2.5 text-[12px] leading-snug">
          <UserCell event={event} />
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px] text-slate-600">
          {view?.localIp ? (
            <span className="block" title="Public IPv4 address of the network the request came from">
              <span className="me-1 rounded bg-primary-50 px-1 py-px font-sans text-[9.5px] font-bold uppercase tracking-wide text-primary-700">
                IPv4
              </span>
              <span className="font-semibold text-slate-800">{view.ipAddress}</span>
            </span>
          ) : (
            view?.ipAddress || '—'
          )}
          {view?.localIp && (
            <span className="block font-sans text-[11px] text-slate-400" title="Address on the local network">
              LAN {view.localIp}
            </span>
          )}
          {view?.deviceName && <span className="block font-sans text-[11px] text-slate-400">{view.deviceName}</span>}
        </td>
        <td className="px-3 py-2.5 text-[12.5px]">
          {view?.who ? (
            <>
              <span className="block font-bold text-slate-800">By: {view.who}</span>
              <span className="mt-0.5 flex items-start gap-1.5 text-slate-700">
                <span aria-hidden="true" className="font-bold text-primary-700">→</span>
                <span>{view.did}</span>
              </span>
              {view.other && (
                <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-primary-700">
                  <span aria-hidden="true">→</span>
                  <span>{view.other}</span>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="block font-bold text-slate-800">{ACTOR_LABEL[event.actorType] || event.actorType}</span>
              <span className="block text-slate-700">{humaniseAction(event.action)}</span>
            </>
          )}
        </td>
        <td className="px-3 py-2.5">
          {event.queryId ? (
            <button
              type="button"
              onClick={() => onOpenQuery?.(event.queryId)}
              className="rounded font-mono text-[11.5px] font-bold text-primary-700 underline-offset-2 hover:underline"
            >
              {event.queryId}
            </button>
          ) : (
            <span className="text-[11.5px] text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <ResultChip result={event.result} />
        </td>
      </tr>

      {open && hasDetail && <DetailRow event={event} />}
    </>
  );
}

export function AuditTable({ events, loading, error, onOpenQuery, emptyTitle = 'No matching events' }) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading audit events">
        <Skeleton className="h-9 w-full rounded-lg" />
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800">
        <p className="m-0 font-bold">Could not load the audit trail</p>
        <p className="m-0 mt-0.5 text-[13px]">{error}</p>
      </div>
    );
  }

  if (!events.length) {
    return <EmptyState icon={ShieldOff} title={emptyTitle} description="Nothing has been recorded for these filters yet." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-160 border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <th scope="col" className="w-10 px-3 py-2">
              <span className="sr-only">Expand row</span>
            </th>
            <th scope="col" className="px-3 py-2">Audit ID</th>
            <th scope="col" className="px-3 py-2">Date &amp; time</th>
            <th scope="col" className="px-3 py-2">User</th>
            <th scope="col" className="px-3 py-2">IP address / device</th>
            <th scope="col" className="px-3 py-2">Activity</th>
            <th scope="col" className="px-3 py-2">Case No.</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <Row key={event._id || stableKey(event)} event={event} onOpenQuery={onOpenQuery} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
