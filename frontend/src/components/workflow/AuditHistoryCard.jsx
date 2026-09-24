import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { stableKey } from '@/utils/stableKey';

const AUDIT_PREVIEW = 8;

function auditBadgeColor(rawEvent) {
  if (rawEvent.includes('REJECT')) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (rawEvent.includes('CLOSED') || rawEvent.includes('REGISTERED')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (rawEvent.includes('AI') || rawEvent.includes('DRAFT')) {
    return 'bg-purple-50 text-purple-700 border-purple-200';
  }
  if (rawEvent.includes('FORWARD') || rawEvent.includes('ASSIGN')) {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function describeActor(actor) {
  const name = actor?.toLowerCase() || '';

  if (name.includes('ai') || name.includes('assistant')) {
    return {
      icon: '🤖 ',
      className: 'bg-purple-50 text-purple-800 border-purple-200',
    };
  }
  if (name === 'system') {
    return {
      icon: '⚙️ ',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  }
  return {
    icon: '👤 ',
    className: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  };
}

function describeDetails(details) {
  if (!details) return '—';
  if (typeof details === 'string') return details;
  if (typeof details !== 'object') return String(details);

  const pairs = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);

  return pairs.length ? pairs.join(' · ') : '—';
}

function AuditRow({ entry }) {
  const rawEvent = String(entry.event || entry.action || '').toUpperCase();
  const eventText = rawEvent.replace(/_/g, ' ') || '—';
  const actor = describeActor(entry.actor);
  const at = new Date(entry.at);

  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="py-2 px-4 align-top whitespace-nowrap">
        <span
          className={`inline-flex items-center text-[13px] font-black px-3 py-1 rounded-full border shadow-2xs ${auditBadgeColor(rawEvent)}`}
        >
          {eventText}
        </span>
      </td>

      <td className="py-2 px-4 align-top whitespace-nowrap">
        <span
          className={`inline-flex items-center gap-1.5 text-[14px] font-bold px-2.5 py-1 rounded-xl border ${actor.className}`}
        >
          {actor.icon}
          {entry.actor}
        </span>
      </td>

      <td className="py-2 px-4 align-top font-medium text-slate-700 max-w-md leading-relaxed">
        {describeDetails(entry.details)}
      </td>

      <td className="py-2 px-4 align-top text-right whitespace-nowrap font-semibold text-slate-400 text-[14px]">
        {at.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
        <span className="mx-1">•</span>
        {at.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </td>
    </tr>
  );
}

export function AuditHistoryCard({ audit }) {
  const [showAll, setShowAll] = useState(false);

  const newestFirst = [...audit].reverse();
  const visible = showAll ? newestFirst : newestFirst.slice(0, AUDIT_PREVIEW);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm overflow-hidden select-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/80 flex items-center justify-center shadow-2xs">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-heading text-[19px] font-black text-slate-900 m-0 leading-tight">
              Audit history
            </h2>
            <p className="text-[12.5px] font-medium text-slate-400 m-0">
              Append-only trail, newest first.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {audit.length > AUDIT_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((shown) => !shown)}
              className="text-[12px] font-bold text-slate-500 hover:text-indigo-700 bg-white hover:bg-indigo-50 px-3 py-1.5 rounded-xl border border-slate-200/80 transition-colors cursor-pointer"
            >
              {showAll ? 'Show recent only' : `Show all ${audit.length} events`}
            </button>
          )}
          <span className="text-[12.5px] font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200/80 shadow-2xs">
            {audit.length} Total Events
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[13.5px] font-black text-slate-400 uppercase tracking-wider">
              <th scope="col" className="py-2.5 px-4">
                Event
              </th>
              <th scope="col" className="py-2.5 px-4">
                Actor
              </th>
              <th scope="col" className="py-2.5 px-4">
                Details
              </th>
              <th scope="col" className="py-2.5 px-4 text-right">
                When
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[15px]">
            {visible.map((entry) => (
              <AuditRow key={entry.auditId || stableKey(entry)} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
