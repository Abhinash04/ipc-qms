import { useState, useEffect } from 'react';
import {
  Clock,
  User,
  Calendar,
  Hourglass,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Timer,
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

const HISTORY_PREVIEW = 3;

// Full class strings so Tailwind can see them.
const ACCENTS = {
  blue: {
    card: 'bg-[#F0F6FF] border-blue-100 border-l-blue-500',
    icon: 'bg-blue-100 text-blue-600',
    label: 'text-blue-600',
    chevron: 'text-blue-400',
  },
  purple: {
    card: 'bg-[#F7F3FF] border-purple-100 border-l-purple-500',
    icon: 'bg-purple-100 text-purple-600',
    label: 'text-purple-600',
    chevron: 'text-purple-400',
  },
  emerald: {
    card: 'bg-[#EEFAF7] border-emerald-100 border-l-emerald-500',
    icon: 'bg-emerald-100 text-emerald-600',
    label: 'text-emerald-600',
    chevron: 'text-emerald-400',
  },
  amber: {
    card: 'bg-[#FFF6ED] border-amber-100 border-l-amber-500',
    icon: 'bg-amber-100 text-amber-600',
    label: 'text-amber-600',
    chevron: 'text-amber-400',
  },
};

/** Ticks every second while the assignment's timer runs, and keeps asking the server once it has expired. */
function useTransferCountdown(query) {
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

  const remainingSeconds = live ? Math.max(0, Math.floor((deadline - now) / 1000)) : 0;
  return { live, expired, remainingSeconds };
}

function countdownTextClass(expired, remainingSeconds) {
  if (expired) return 'text-rose-600 animate-pulse';
  if (remainingSeconds < 30) return 'text-rose-600';
  if (remainingSeconds < 60) return 'text-amber-600';
  return 'text-slate-900';
}

function TimerHeader({ minutes }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-full bg-linear-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-xs shrink-0">
          <Timer className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-heading text-lg sm:text-xl font-bold text-slate-900 m-0 leading-tight tracking-tight">
            Action Timeline &amp; Auto Transfer Status
          </h2>
          <p className="text-xs font-medium text-slate-500 m-0 mt-0.5">
            {minutes
              ? `The assigned official has ${minutes} minute${minutes === 1 ? '' : 's'} to act before the case moves to the next recommended official.`
              : 'Automatic transfer is not running for this assignment.'}
          </p>
        </div>
      </div>

      {minutes && (
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-100/70 border border-purple-200 px-3.5 py-1.5 rounded-full shadow-2xs">
          <Clock className="w-3.5 h-3.5 text-purple-600" />
          <span>Limit: {minutes} min</span>
        </div>
      )}
    </div>
  );
}

function InfoCard({ accent, icon: Icon, label, hint, children }) {
  const tone = ACCENTS[accent];
  return (
    <div
      className={`rounded-2xl border border-l-[5px] ${tone.card} p-3.5 sm:p-4 flex items-center justify-between gap-3 transition-shadow hover:shadow-xs`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={`w-9 h-9 rounded-full ${tone.icon} flex items-center justify-center shrink-0`}>
          <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${tone.label} block`}>{label}</span>
          {children}
          <span className="text-[11px] font-medium text-slate-500 truncate block mt-0.5">{hint}</span>
        </div>
      </div>
      <ChevronRight className={`w-4 h-4 ${tone.chevron} shrink-0`} />
    </div>
  );
}

function TransferStatusBadge({ failed, expired, live }) {
  if (failed) {
    return (
      <span className="bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
        Stopped — no eligible official left
      </span>
    );
  }
  if (expired) {
    return (
      <span className="bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
        Deadline passed — transferring to the next recommended official
      </span>
    );
  }
  if (live) {
    return (
      <span className="bg-[#FFF3D6] text-amber-900 border border-amber-200/80 font-bold px-3 py-1 rounded-full text-xs flex items-center gap-1.5 shadow-2xs">
        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        Awaiting action from the assigned official
      </span>
    );
  }
  return (
    <span className="bg-slate-200/70 text-slate-700 border border-slate-300 px-3 py-1 rounded-full font-bold text-xs">
      Not running
    </span>
  );
}

function TransferStatusBar({ failed, expired, live, autoTransferCount }) {
  return (
    <div className="rounded-2xl bg-[#F0F6FF]/90 border border-blue-100 p-3 px-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-slate-700">
      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
        <div className="w-7.5 h-7.5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
        </div>
        <span className="font-bold text-[10.5px] tracking-wider text-blue-600/90 uppercase shrink-0">
          AUTO TRANSFER STATUS
        </span>
        <span className="hidden sm:block h-3.5 w-px bg-blue-200/80 mx-1" aria-hidden="true" />
        <TransferStatusBadge failed={failed} expired={expired} live={live} />
      </div>

      <div className="flex items-center gap-2 shrink-0 ms-auto sm:ms-0">
        <span className="font-bold text-[10.5px] tracking-wider text-blue-600/90 uppercase">
          AUTO TRANSFERS
        </span>
        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center border border-blue-200/80">
          {autoTransferCount}
        </span>
      </div>
    </div>
  );
}

function FailedTransferAlert({ assigneeName }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50/90 p-3.5 px-4 flex items-center gap-3 text-xs text-rose-900 font-semibold shadow-2xs"
    >
      <div className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
        <AlertCircle className="h-4 w-4" strokeWidth={2.5} />
      </div>
      <span>
        The action limit passed, but no eligible recommended official remains. The case stays with{' '}
        {assigneeName} and the Officer-in-Charge has been notified to reassign it.
      </span>
    </div>
  );
}

function TransferRow({ item, number }) {
  const fromUser = findUserById(item.fromAssigneeId);
  const toUser = findUserById(item.toAssigneeId);
  const automatic = item.transferType === 'AUTO_TRANSFER';
  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="py-2.5 px-3.5 font-bold text-slate-400">{number}</td>
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
}

function TransferHistory({ history }) {
  const [showAll, setShowAll] = useState(false);
  if (history.length === 0) return null;
  const visible = showAll ? history : history.slice(0, HISTORY_PREVIEW);

  return (
    <div className="pt-3 border-t border-slate-100">
      <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2.5 flex items-center gap-2 m-0">
        <RefreshCw className="h-3.5 w-3.5 text-indigo-500" strokeWidth={2.2} />
        Transfer History ({history.length})
      </h3>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-400 font-bold uppercase tracking-wider text-[10.5px]">
              <th className="py-2.5 px-3.5">#</th>
              <th className="py-2.5 px-3.5">From</th>
              <th className="py-2.5 px-3.5">To</th>
              <th className="py-2.5 px-3.5">Type</th>
              <th className="py-2.5 px-3.5">When</th>
              <th className="py-2.5 px-3.5">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((item, position) => (
              <TransferRow
                key={`${item.transferredAt}-${item.fromAssigneeId}-${item.toAssigneeId}`}
                item={item}
                number={position + 1}
              />
            ))}
          </tbody>
        </table>
      </div>

      {history.length > HISTORY_PREVIEW && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-indigo-50/50 py-1.5 px-4 rounded-full border border-indigo-200 shadow-2xs hover:shadow-xs transition-[color,background-color,box-shadow] cursor-pointer"
          >
            {showAll ? (
              <>
                <span>Show less</span>
                <ChevronUp className="h-3.5 w-3.5 text-indigo-600" />
              </>
            ) : (
              <>
                <span>
                  Showing {HISTORY_PREVIEW} of {history.length} transfers — Show remaining{' '}
                  {history.length - HISTORY_PREVIEW}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-indigo-600" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export function AutoTransferTimerCard({ query }) {
  const { live, expired, remainingSeconds } = useTransferCountdown(query);

  if (!query || query.workflowState !== 'ASSIGNED' || query.businessStatus === 'CLOSED') return null;

  const transferHistory = Array.isArray(query.transferHistory) ? query.transferHistory : [];
  const failed = Boolean(query.autoTransferFailed);
  if (!live && !failed && transferHistory.length === 0) return null;

  const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;
  const assigneeName = assignee?.name || query.currentAssigneeId;
  const minutes = limitMinutes(query.assignedAt, query.actionDeadline);

  return (
    <div
      data-slot="panel"
      className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm select-none space-y-5 text-slate-800"
    >
      <TimerHeader minutes={minutes} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard accent="blue" icon={User} label="ASSIGNED OFFICER" hint="Currently handling this query">
          <span className="font-bold text-[14.5px] text-slate-900 truncate block mt-0.5">
            {assigneeName || 'Unassigned'}
          </span>
        </InfoCard>

        <InfoCard accent="purple" icon={Calendar} label="ASSIGNMENT TIME" hint="Query assigned to the officer">
          <span className="font-bold text-[13px] text-slate-900 truncate block mt-0.5">
            {formatDateTime(query.assignedAt)}
          </span>
        </InfoCard>

        <InfoCard
          accent="emerald"
          icon={Clock}
          label="ACTION DEADLINE"
          hint={minutes ? `${minutes} minutes remaining` : 'Action deadline timestamp'}
        >
          <span className="font-bold text-[13px] text-slate-900 truncate block mt-0.5">
            {formatDateTime(query.actionDeadline)}
          </span>
        </InfoCard>

        <InfoCard accent="amber" icon={Hourglass} label="REMAINING TIME" hint="Auto transfer will be triggered">
          {live ? (
            <span
              data-testid="auto-transfer-countdown"
              className={`font-bold text-[15px] block mt-0.5 ${countdownTextClass(expired, remainingSeconds)}`}
            >
              {formatCountdown(remainingSeconds)}
            </span>
          ) : (
            <span className="font-bold text-[13px] text-slate-600 block mt-0.5">Not running</span>
          )}
        </InfoCard>
      </div>

      <TransferStatusBar
        failed={failed}
        expired={expired}
        live={live}
        autoTransferCount={query.autoTransferCount || 0}
      />

      {failed && <FailedTransferAlert assigneeName={assigneeName} />}

      <TransferHistory history={transferHistory} />
    </div>
  );
}
