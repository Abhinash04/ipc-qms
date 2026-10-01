import { useState, useEffect } from 'react';
import {
  Clock,
  User,
  Calendar,
  Hourglass,
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { findUserById } from '@/constants/mockUsers';
import { useWorkflowStore } from '@/store/useWorkflowStore';

const REFRESH_AFTER_EXPIRY_MS = 5000;

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatCountdown(totalSeconds) {
  if (totalSeconds <= 0) return '0m 00s';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

function limitMinutes(assignedAt, actionDeadline) {
  const start = Date.parse(assignedAt);
  const end = Date.parse(actionDeadline);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const minutes = (end - start) / 60000;
  return Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(1));
}

const TRANSFER_LABELS = { AUTO_TRANSFER: 'AUTOMATIC', MANUAL: 'MANUAL' };

export function AutoTransferTimerCard({ query }) {
  const [now, setNow] = useState(() => Date.now());
  const [showAllHistory, setShowAllHistory] = useState(false);
  const revalidate = useWorkflowStore((state) => state.revalidate);

  const deadline = query?.actionDeadline ? Date.parse(query.actionDeadline) : null;
  const live =
    query?.workflowState === 'ASSIGNED' && query?.businessStatus !== 'CLOSED' && Number.isFinite(deadline);
  const expired = live && now >= deadline;

  useEffect(() => {
    if (!live) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live, query?.actionDeadline]);

  useEffect(() => {
    if (!expired || typeof revalidate !== 'function') return undefined;
    const interval = setInterval(() => revalidate(), REFRESH_AFTER_EXPIRY_MS);
    return () => clearInterval(interval);
  }, [expired, revalidate]);

  if (!query || query.workflowState !== 'ASSIGNED' || query.businessStatus === 'CLOSED') return null;

  const transferHistory = Array.isArray(query.transferHistory) ? query.transferHistory : [];
  const failed = Boolean(query.autoTransferFailed);
  if (!live && !failed && transferHistory.length === 0) return null;

  const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;
  const minutes = limitMinutes(query.assignedAt, query.actionDeadline);
  const remainingSeconds = live ? Math.max(0, Math.floor((deadline - now) / 1000)) : 0;
  const autoTransferCount = query.autoTransferCount || 0;
  const visibleHistory = showAllHistory ? transferHistory : transferHistory.slice(0, 3);

  let timerBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (expired) {
    timerBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse';
  } else if (remainingSeconds < 30) {
    timerBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
  } else if (remainingSeconds < 60) {
    timerBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
  }

  return (
    <div
      data-slot="panel"
      className="bg-white rounded-[20px] border border-[#E6EAF2] p-5 sm:p-6 shadow-[0_4px_20px_-2px_rgba(99,102,241,0.06)] select-none space-y-4 text-slate-800"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6EAF2] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <Clock className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-heading text-[20px] sm:text-[21px] font-bold text-slate-900 m-0 leading-tight tracking-tight">
              Action Timeline &amp; Auto Transfer Status
            </h2>
            <p className="text-xs font-medium text-slate-500 m-0 mt-0.5">
              {minutes
                ? `The assigned official has ${minutes} minute${minutes === 1 ? '' : 's'} to act before the case moves to the next recommended official`
                : 'Automatic transfer is not running for this assignment'}
            </p>
          </div>
        </div>

        {minutes && (
          <span className="text-xs font-bold text-indigo-700 bg-indigo-50/80 px-3 py-1 rounded-full border border-indigo-200/80 shadow-2xs">
            Limit: {minutes} min
          </span>
        )}
      </div>

      {/* Information Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Assigned Officer */}
        <div className="bg-blue-100/70 border border-blue-200/80 p-3.5 rounded-2xl flex items-center gap-3 transition-all hover:bg-blue-100/90">
          <div className="w-9 h-9 rounded-full bg-blue-200/80 text-blue-700 flex items-center justify-center shrink-0">
            <User className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10.5px] font-bold uppercase text-blue-900/70 tracking-wider block">
              Assigned Officer
            </span>
            <span className="font-bold text-[14px] text-slate-900 truncate block mt-0.5">
              {assignee?.name || query.currentAssigneeId || 'Unassigned'}
            </span>
          </div>
        </div>

        {/* Card 2: Assignment Time */}
        <div className="bg-purple-100/70 border border-purple-200/80 p-3.5 rounded-2xl flex items-center gap-3 transition-all hover:bg-purple-100/90">
          <div className="w-9 h-9 rounded-full bg-purple-200/80 text-purple-700 flex items-center justify-center shrink-0">
            <Calendar className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10.5px] font-bold uppercase text-purple-900/70 tracking-wider block">
              Assignment Time
            </span>
            <span className="font-bold text-[13px] text-slate-900 block mt-0.5">
              {formatDateTime(query.assignedAt)}
            </span>
          </div>
        </div>

        {/* Card 3: Action Deadline */}
        <div className="bg-sky-100/70 border border-sky-200/80 p-3.5 rounded-2xl flex items-center gap-3 transition-all hover:bg-sky-100/90">
          <div className="w-9 h-9 rounded-full bg-sky-200/80 text-sky-700 flex items-center justify-center shrink-0">
            <Clock className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10.5px] font-bold uppercase text-sky-900/70 tracking-wider block">
              Action Deadline
            </span>
            <span className="font-bold text-[13px] text-slate-900 block mt-0.5">
              {formatDateTime(query.actionDeadline)}
            </span>
          </div>
        </div>

        {/* Card 4: Remaining Time */}
        <div className="bg-amber-100/70 border border-amber-200/80 p-3.5 rounded-2xl flex items-center gap-3 transition-all hover:bg-amber-100/90">
          <div className="w-9 h-9 rounded-full bg-amber-200/80 text-amber-700 flex items-center justify-center shrink-0">
            <Hourglass className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10.5px] font-bold uppercase text-amber-900/70 tracking-wider block">
              Remaining Time
            </span>
            {live ? (
              <span
                data-testid="auto-transfer-countdown"
                className={`inline-flex items-center gap-1.5 font-bold text-[13px] px-2.5 py-0.5 rounded-full border mt-0.5 ${timerBadgeColor}`}
              >
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {formatCountdown(remainingSeconds)}
              </span>
            ) : (
              <span className="font-semibold text-[13px] text-slate-600 block mt-0.5">Not running</span>
            )}
          </div>
        </div>
      </div>

      {/* Auto Transfer Status Bar */}
      <div className="rounded-2xl border border-[#E6EAF2] bg-slate-50/70 p-3 px-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-blue-100/60 text-blue-600 flex items-center justify-center shrink-0">
            <Info className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px]">
            AUTO TRANSFER STATUS:
          </span>
          {failed ? (
            <span className="bg-rose-100/80 text-rose-700 border border-rose-200/80 px-3 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-2xs">
              <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
              Stopped — no eligible official left
            </span>
          ) : expired ? (
            <span className="bg-rose-100/80 text-rose-700 border border-rose-200/80 px-3 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-2xs">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
              Deadline passed — transferring to the next recommended official
            </span>
          ) : live ? (
            <span className="bg-amber-100/80 text-amber-800 border border-amber-200/80 px-3 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-2xs">
              <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              Awaiting action from the assigned official
            </span>
          ) : (
            <span className="bg-slate-200/70 text-slate-700 border border-slate-300/80 px-3 py-1 rounded-full font-bold">
              Not running
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px]">AUTO TRANSFERS:</span>
          <span className="font-bold text-indigo-700 bg-indigo-100/80 px-2.5 py-0.5 rounded-full border border-indigo-200/80 text-[12px]">
            {autoTransferCount}
          </span>
        </div>
      </div>

      {/* Warning / Information Alert */}
      {failed && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3.5 px-4 flex items-center gap-3 text-xs text-rose-900 font-semibold shadow-2xs"
        >
          <div className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span>
            The action limit passed, but no eligible recommended official remains. The case stays with{' '}
            {assignee?.name || query.currentAssigneeId} and the Officer-in-Charge has been notified to reassign it.
          </span>
        </div>
      )}

      {/* Transfer History Table */}
      {transferHistory.length > 0 && (
        <div className="pt-3 border-t border-[#E6EAF2]">
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2.5 flex items-center gap-2 m-0">
            <RefreshCw className="h-3.5 w-3.5 text-indigo-500" strokeWidth={2.2} />
            Transfer History ({transferHistory.length})
          </h3>

          <div className="overflow-x-auto rounded-2xl border border-[#E6EAF2] bg-white shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-[#E6EAF2] text-slate-400 font-bold uppercase tracking-wider text-[10.5px]">
                  <th className="py-2.5 px-3.5">#</th>
                  <th className="py-2.5 px-3.5">From</th>
                  <th className="py-2.5 px-3.5">To</th>
                  <th className="py-2.5 px-3.5">Type</th>
                  <th className="py-2.5 px-3.5">When</th>
                  <th className="py-2.5 px-3.5">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleHistory.map((item, idx) => {
                  const fromUser = findUserById(item.fromAssigneeId);
                  const toUser = findUserById(item.toAssigneeId);
                  const automatic = item.transferType === 'AUTO_TRANSFER';
                  return (
                    <tr key={`${item.transferredAt}-${idx}`} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 px-3.5 font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                        {fromUser?.name || item.fromAssigneeId}
                      </td>
                      <td className="py-2.5 px-3.5 font-bold text-purple-700">
                        {toUser?.name || item.toAssigneeId}
                      </td>
                      <td className="py-2.5 px-3.5">
                        <span
                          className={`font-bold px-2.5 py-0.5 rounded-full text-[10px] border ${automatic ? 'bg-purple-100/70 text-purple-700 border-purple-200/80' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                        >
                          {TRANSFER_LABELS[item.transferType] || item.transferType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-500 font-medium whitespace-nowrap">
                        {formatDateTime(item.transferredAt)}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-600 max-w-xs truncate">
                        {item.reason || '—'}
                        {automatic && item.matchPercent != null ? ` (AI match ${item.matchPercent}%)` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {transferHistory.length > 3 && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setShowAllHistory((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-50/50 py-1.5 px-4 rounded-full border border-indigo-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer"
              >
                {showAllHistory ? (
                  <>
                    <span>Show less</span>
                    <ChevronUp className="h-3.5 w-3.5 text-indigo-600" />
                  </>
                ) : (
                  <>
                    <span>
                      Showing 3 of {transferHistory.length} transfers — Show remaining {transferHistory.length - 3}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-indigo-600" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


