import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  ChevronDown, 
  FileText, 
  Mail, 
  Clock, 
  Calendar, 
  Copy, 
  MoreVertical, 
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Archive,
  Inbox
} from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { buildPath } from '@/constants/routePaths';
import { ROLE_LABELS } from '@/constants/roles';
import { ROLE_SLUG } from '@/constants/permissions';
import { useAuthStore } from '@/store/useAuthStore';

export function QueryTable({ title, purpose, breadcrumbItems, detailPath, filter, actions, emptyMessage }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const allQueries = useWorkflowStore((state) => state.queries);
  const queries = filter ? allQueries.filter(filter) : allQueries;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  const filteredQueries = queries.filter((q) => {
    const matchSearch =
      !searchQuery ||
      q.queryId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.inquirer?.name && q.inquirer.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchPriority = priorityFilter === 'ALL' || q.priority === priorityFilter;
    return matchSearch && matchPriority;
  });

  const getQueryDetailPath = (queryId) => {
    if (detailPath) {
      return buildPath(detailPath, { queryId });
    }
    const slug = ROLE_SLUG[currentUser?.role] || 'officer-in-charge';
    return `/${slug}/queries/${queryId}`;
  };

  const formatStatus = (statusStr) => {
    if (!statusStr) return 'PENDING APPROVAL';
    return statusStr.replace(/_/g, ' ').toUpperCase();
  };

  const getPriorityStyle = (priority) => {
    switch (priority?.toUpperCase()) {
      case 'URGENT':
      case 'HIGH':
        return 'bg-rose-100/80 text-rose-700 border-rose-200/80';
      case 'LOW':
        return 'bg-slate-100/80 text-slate-600 border-slate-200/80';
      default:
        return 'bg-blue-100/70 text-blue-700 border-blue-200/80';
    }
  };

  return (
    <div className="space-y-6">
      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-2xs">
            <Archive className="h-6.5 w-6.5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="font-heading text-[52px] sm:text-[60px] font-black tracking-tight text-transparent bg-clip-text bg-linear-to-r from-slate-900 via-sidebar-tooltip to-blue-900 m-0 leading-none drop-shadow-2xs">
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
                placeholder="Search queries by ID, subject, or inquirer..."
                className="w-full rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-11 pr-4 py-3 text-[13.5px] font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>

            <div className="relative w-full sm:w-56 shrink-0">
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="w-full appearance-none rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-10 pr-10 py-3 text-[13.5px] font-bold text-slate-700 cursor-pointer hover:bg-slate-100/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              >
                <option value="ALL">All priorities</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="NORMAL">Normal</option>
                <option value="LOW">Low</option>
              </select>
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div className="grid grid-cols-[170px_1fr_150px_220px_180px_150px_32px] gap-3 px-6 py-3.5 bg-[#f9f9fe] border-b border-slate-100/80 rounded-2xl text-[12px] font-extrabold text-slate-700 tracking-wider">
            <div className="flex items-center gap-1.5">
              <span>Query ID</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span>Subject</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 justify-center">
              <span>Priority</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5 justify-center">
              <span>Status</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span>Assignee</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span>Received On</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <span></span>
          </div>

          <div className="space-y-3.5 mt-3.5">
            {filteredQueries.length > 0 ? (
              filteredQueries.map((query) => {
                const assignee = query.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;
                const assigneeName = assignee?.name || query.inquirer?.name || 'Unassigned';
                const assigneeRole = assignee?.role ? ROLE_LABELS[assignee.role] : (query.inquirer ? 'Inquirer' : 'Assigned Official');
                const initials = assigneeName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'Q';

                const createdDate = query.createdAt ? new Date(query.createdAt) : new Date('2026-08-19T09:30:00');
                const dateFormatted = createdDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const timeFormatted = createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                return (
                  <Link
                    key={query.queryId}
                    to={getQueryDetailPath(query.queryId)}
                    className="group relative flex items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:shadow-md hover:border-purple-200 transition-all overflow-hidden grid grid-cols-[170px_1fr_150px_220px_180px_150px_32px] gap-3 items-center cursor-pointer"
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
                        {query.subject || '(No Subject)'}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 mt-0.5">
                        <Mail className="h-3.5 w-3.5 text-purple-500" />
                        <span>Mail received</span>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11.5px] font-extrabold border shadow-2xs ${getPriorityStyle(query.priority)}`}>
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {query.priority || 'NORMAL'}
                      </span>
                    </div>

                    <div className="flex justify-center">
                      <span className="inline-flex items-center gap-2 rounded-full bg-purple-100/70 px-4 py-1.5 text-[11.5px] font-extrabold text-purple-700 border border-purple-200/80 shadow-2xs">
                        <Clock className="h-3.5 w-3.5 text-purple-600" />
                        {formatStatus(query.businessStatus || query.workflowState)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-extrabold text-[12px]">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-slate-800 truncate">
                          {assigneeName}
                        </div>
                        <div className="text-[11px] font-medium text-slate-400 truncate">
                          {assigneeRole}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>{dateFormatted}</span>
                      </div>
                      <div className="text-[11px] font-medium text-slate-400 pl-5 mt-0.5">
                        {timeFormatted}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="p-1 rounded-lg text-slate-400 group-hover:text-slate-600 transition-colors">
                        <MoreVertical className="h-4.5 w-4.5" />
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                <Inbox className="mx-auto h-10 w-10 text-slate-300 mb-2" />
                <p className="font-bold text-[14px] text-slate-700">No matching queries found</p>
                <p className="text-[12.5px] text-slate-400 mt-1">
                  {emptyMessage || 'Try adjusting your search or priority filter.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100/80 flex items-center justify-between bg-white">
          <span className="text-[13px] font-medium text-slate-500">
            Showing {filteredQueries.length} of {queries.length} result{queries.length === 1 ? '' : 's'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 opacity-50 cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-blue-600 text-white font-extrabold text-[13px] shadow-md shadow-blue-500/20"
            >
              1
            </button>
            <button
              type="button"
              disabled
              className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 opacity-50 cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
