import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  ChevronDown, 
  FileText, 
  Mail, 
  Clock, 
  Inbox, 
  Calendar, 
  Copy, 
  MoreVertical, 
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Archive
} from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { buildPath } from '@/constants/routePaths';
import { ROLE_LABELS } from '@/constants/roles';

export function QueryTable({ title, purpose, breadcrumbItems, detailPath, filter, actions, emptyMessage }) {
  const allQueries = useWorkflowStore((state) => state.queries);
  const queries = filter ? allQueries.filter(filter) : allQueries;
  const [searchQuery, setSearchQuery] = useState('');

  const filteredQueries = queries.filter((q) => {
    const matchSearch =
      !searchQuery ||
      q.queryId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.subject.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="space-y-6">
      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-2xs">
            <Archive className="h-6.5 w-6.5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="font-heading text-[52px] sm:text-[60px] font-black tracking-tight text-transparent bg-clip-text bg-linear-to-r from-slate-900 via-[#0f285d] to-blue-900 m-0 leading-none drop-shadow-2xs">
              {title || 'Queries'}
            </h1>
            <p className="m-0 text-[14.5px] font-medium text-slate-400 mt-2">
              {purpose || 'All registered queries across the organization.'}
            </p>
          </div>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/70 overflow-hidden shadow-sm flex flex-col justify-between">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search queries by ID, subject, or assignee..."
                className="w-full rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-11 pr-4 py-3 text-[13.5px] font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>

            <div className="relative w-full sm:w-56 shrink-0">
              <div className="flex items-center justify-between rounded-2xl bg-slate-50/70 border border-slate-200/70 px-4 py-3 text-[13.5px] font-bold text-slate-700 cursor-pointer hover:bg-slate-100/60 transition-colors">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-slate-500" />
                  <span>All priorities</span>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[170px_1fr_150px_220px_180px_150px_32px] gap-3 px-6 py-3.5 bg-[#f9f9fe] border-b border-slate-100/80 rounded-2xl text-[12px] font-extrabold text-slate-700 tracking-wider">
            <div className="flex items-center gap-1.5 cursor-pointer">
              <span>Query ID</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 cursor-pointer">
              <span>Subject</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 cursor-pointer justify-center">
              <span>Priority</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 cursor-pointer justify-center">
              <span>Status</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 cursor-pointer">
              <span>Assignee</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 cursor-pointer">
              <span>Received On</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <span></span>
          </div>

          <div className="space-y-3.5 mt-3.5">
            {filteredQueries.length > 0 ? (
              filteredQueries.map((query) => {
                const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;
                const initials = assignee?.name
                  ? assignee.name.split(' ').map((n) => n[0]).join('')
                  : 'NS';

                return (
                  <Link
                    key={query.queryId}
                    to={detailPath ? buildPath(detailPath, { queryId: query.queryId }) : '#'}
                    className="group relative grid grid-cols-[170px_1fr_150px_220px_180px_150px_32px] items-center gap-3 bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:shadow-md hover:border-purple-200 transition-all overflow-hidden"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-purple-600 rounded-l-2xl" />

                    <div className="flex items-center gap-3 shrink-0 pl-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                        <FileText className="h-5 w-5" strokeWidth={1.8} />
                      </div>
                      <div>
                        <div className="font-heading text-[13.5px] font-extrabold text-purple-700 group-hover:underline">
                          {query.queryId}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400 mt-0.5">
                          <Copy className="h-3 w-3 text-purple-500" />
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 px-2">
                      <div className="text-[14px] font-bold text-slate-900 truncate group-hover:text-purple-700">
                        {query.subject || 'test mail'}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 mt-0.5">
                        <Mail className="h-3.5 w-3.5 text-purple-500" />
                        <span>Mail received</span>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-2 rounded-full bg-blue-100/70 px-4 py-1.5 text-[11.5px] font-extrabold text-blue-700 border border-blue-200/80 shadow-2xs">
                        <span className="h-2 w-2 rounded-full bg-blue-600" />
                        {query.priority || 'NORMAL'}
                      </span>
                    </div>

                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-2 rounded-full bg-purple-100/70 px-4 py-1.5 text-[11.5px] font-extrabold text-purple-700 border border-purple-200/80 shadow-2xs">
                        <Clock className="h-3.5 w-3.5 text-purple-600" />
                        PENDING FINAL APPROVAL
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-extrabold text-[12px]">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-slate-800 truncate">
                          {assignee?.name || 'Unassigned'}
                        </div>
                        <div className="text-[11px] font-medium text-slate-400">
                          {assignee?.role ? ROLE_LABELS[assignee.role] : 'Assigned Official'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>19 Aug 2026</span>
                      </div>
                      <div className="text-[11px] font-medium text-slate-400 pl-5 mt-0.5">
                        09:30 AM
                      </div>
                    </div>

                    {/* Column 7: Menu */}
                    <div className="flex justify-end">
                      <div className="p-1 rounded-lg text-slate-400 group-hover:text-slate-600 transition-colors">
                        <MoreVertical className="h-4.5 w-4.5" />
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <EmptyState
                icon={Inbox}
                title="No queries to show"
                description={emptyMessage || "Queries appear here once an enquiry has been registered."}
              />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100/80 flex items-center justify-between bg-white">
          <span className="text-[13px] font-medium text-slate-500">
            Showing {filteredQueries.length || 1} of {filteredQueries.length || 1} result
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 hover:bg-slate-200/70 transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-blue-600 text-white font-extrabold text-[13px] shadow-md shadow-blue-500/20 cursor-pointer"
            >
              1
            </button>
            <button
              type="button"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 hover:bg-slate-200/70 transition-colors cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
