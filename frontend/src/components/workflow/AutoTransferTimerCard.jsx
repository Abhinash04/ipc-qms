import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, ArrowRightLeft, ShieldAlert } from 'lucide-react';
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

  let timerBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (expired) {
    timerBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse';
  } else if (remainingSeconds < 30) {
    timerBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
  } else if (remainingSeconds < 60) {
    timerBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
  }

  return (
    <div data-slot="panel" className="bg-card rounded-2xl border border-transparent p-5 shadow-card select-none dark:border-line/60 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center shadow-2xs">
            <Clock className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-heading text-[17px] font-bold text-slate-900 m-0 leading-tight">
              Action Timeline &amp; Auto Transfer Status
            </h2>
            <p className="text-[12px] font-medium text-slate-500 m-0">
              {minutes
                ? `The assigned official has ${minutes} minute${minutes === 1 ? '' : 's'} to act before the case moves to the next recommended official`
                : 'Automatic transfer is not running for this assignment'}
            </p>
          </div>
        </div>

        {minutes && (
          <span className="text-[11.5px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 shadow-2xs">
            Limit: {minutes} min
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
          <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider block">Assigned Officer</span>
          <span className="font-bold text-[13.5px] text-slate-800 truncate block mt-0.5">
            {assignee?.name || query.currentAssigneeId || 'Unassigned'}
          </span>
        </div>

        <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
          <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider block">Assignment Time</span>
          <span className="font-semibold text-[12.5px] text-slate-700 block mt-0.5">
            {formatDateTime(query.assignedAt)}
          </span>
        </div>

        <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
          <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider block">Action Deadline</span>
          <span className="font-semibold text-[12.5px] text-slate-700 block mt-0.5">
            {formatDateTime(query.actionDeadline)}
          </span>
        </div>

        <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
          <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider block">Remaining Time</span>
          {live ? (
            <span
              data-testid="auto-transfer-countdown"
              className={`inline-flex items-center gap-1.5 font-bold text-[13px] px-2.5 py-0.5 rounded-full border mt-0.5 ${timerBadgeColor}`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {formatCountdown(remainingSeconds)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-[12.5px] text-slate-500 mt-0.5">
              Not running
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-400 uppercase tracking-wider text-[11px]">Auto Transfer Status:</span>
          {failed ? (
            <span className="font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> Stopped — no eligible official left
            </span>
          ) : expired ? (
            <span className="font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Deadline passed — transferring to the next recommended official
            </span>
          ) : live ? (
            <span className="font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Awaiting action from the assigned official
            </span>
          ) : (
            <span className="font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
              Not running
            </span>
          )}
        </div>

        <div>
          <span className="font-bold text-slate-400 uppercase tracking-wider text-[11px] mr-1">Auto Transfers:</span>
          <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
            {autoTransferCount}
          </span>
        </div>
      </div>

      {failed && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-center gap-2.5 text-xs text-rose-800 font-semibold">
          <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
          <span>
            The action limit passed, but no eligible recommended official remains. The case stays with{' '}
            {assignee?.name || query.currentAssigneeId} and the Officer-in-Charge has been notified to reassign it.
          </span>
        </div>
      )}

      {transferHistory.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" />
            Transfer History ({transferHistory.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-card">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">From</th>
                  <th className="py-2 px-3">To</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">When</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transferHistory.map((item, idx) => {
                  const fromUser = findUserById(item.fromAssigneeId);
                  const toUser = findUserById(item.toAssigneeId);
                  const automatic = item.transferType === 'AUTO_TRANSFER';
                  return (
                    <tr key={`${item.transferredAt}-${idx}`} className="hover:bg-slate-50/60">
                      <td className="py-2 px-3 font-bold text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">{fromUser?.name || item.fromAssigneeId}</td>
                      <td className="py-2 px-3 font-bold text-purple-700">{toUser?.name || item.toAssigneeId}</td>
                      <td className="py-2 px-3">
                        <span className={`font-bold px-2 py-0.5 rounded-full text-[10px] border ${automatic ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {TRANSFER_LABELS[item.transferType] || item.transferType}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-medium whitespace-nowrap">{formatDateTime(item.transferredAt)}</td>
                      <td className="py-2 px-3 text-slate-600 max-w-xs truncate">
                        {item.reason || '—'}
                        {automatic && item.matchPercent != null ? ` (AI match ${item.matchPercent}%)` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
