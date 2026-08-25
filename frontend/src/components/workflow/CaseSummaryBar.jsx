import { StatusBadge } from '@/components/common/StatusBadge';
import { findUserById } from '@/constants/mockUsers';
import { User, Calendar } from 'lucide-react';

export function CaseSummaryBar({ query }) {
  if (!query) return null;
  const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between select-none">
      <div>
        <span className="text-[12px] font-black tracking-widest text-purple-600 uppercase bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100">
          {query.queryId}
        </span>
        <h1 className="mt-2 text-[26px] font-black text-slate-900 leading-tight">
          {query.subject}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge type="business" value={query.businessStatus} />
          <StatusBadge type="workflow" value={query.workflowState} />
          <StatusBadge type="priority" value={query.priority} />
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            <User className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Assignee</p>
            <p className="font-extrabold text-[13.5px] text-slate-800">{assignee?.name || 'Unassigned'}</p>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-200" />

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            <Calendar className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Due date</p>
            <p className="font-extrabold text-[13.5px] text-slate-800">
              {query.dueDate ? new Date(query.dueDate).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
