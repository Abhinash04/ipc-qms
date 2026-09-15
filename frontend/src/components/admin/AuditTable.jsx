import { useState } from 'react';
import { ChevronRight, AlertTriangle, ShieldOff, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils/cn';
import { formatTime, humaniseAction } from './auditFormat';

/**
 * The audit table.
 *
 * Rows are server records — `{timestamp, actorType, actorId, actorRole,
 * action, result, queryId, messageId, attachmentId, error, aiMetadata,
 * details}` — rendered as-is. Nothing is computed or inferred here.
 */

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

function Row({ event, onOpenQuery }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.details || event.error || event.aiMetadata);

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
        <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] tabular-nums text-slate-600">
          {formatTime(event.timestamp)}
        </td>
        <td className="px-3 py-2.5">
          <span className="text-[12.5px] font-bold text-slate-800">{ACTOR_LABEL[event.actorType] || event.actorType}</span>
          {event.actorRole && <span className="ml-1.5 text-[11.5px] text-slate-400">{event.actorRole}</span>}
        </td>
        <td className="px-3 py-2.5 text-[12.5px] font-semibold text-slate-800">{humaniseAction(event.action)}</td>
        <td className="px-3 py-2.5">
          {event.queryId ? (
            <button
              type="button"
              onClick={() => onOpenQuery?.(event.queryId)}
              className="rounded font-mono text-[11.5px] font-bold text-blue-700 underline-offset-2 hover:underline"
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

      {open && hasDetail && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td />
          <td colSpan={5} className="px-3 pb-3 pt-0">
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
                    <dd className="inline text-slate-700">{String(value)}</dd>
                  </div>
                ))}
              {event.details &&
                Object.entries(event.details).map(([key, value]) => (
                  <div key={key}>
                    <dt className="inline font-bold text-slate-500">{key}: </dt>
                    <dd className="inline break-all text-slate-700">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditTable({ events, loading, error, onOpenQuery, emptyTitle = 'No matching events' }) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading audit events">
        {Array.from({ length: 6 }).map((_, i) => (
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
          <tr className="border-b border-slate-200 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Event</th>
            <th className="px-3 py-2">Query</th>
            <th className="px-3 py-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <Row key={`${event.timestamp}-${event.action}-${index}`} event={event} onOpenQuery={onOpenQuery} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
