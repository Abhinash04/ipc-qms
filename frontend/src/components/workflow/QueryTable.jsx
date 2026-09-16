import { useState } from "react";
import { Link } from "react-router-dom";
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
  Inbox,
} from "lucide-react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { PageHeader } from "@/components/common/PageHeader";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { findUserById } from "@/constants/mockUsers";
import { buildPath } from "@/constants/routePaths";
import { ROLE_LABELS } from "@/constants/roles";
import { ROLE_SLUG } from "@/constants/permissions";
import { useAuthStore } from "@/store/useAuthStore";

/** Header row and data rows must share one column template. */
const GRID = "grid-cols-[170px_1fr_150px_220px_180px_150px_32px]";

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All priorities" },
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
];

const COLUMNS = [
  { label: "Query ID" },
  { label: "Subject" },
  { label: "Priority", center: true },
  { label: "Status", center: true },
  { label: "Assignee" },
  { label: "Received On" },
];

const formatStatus = (statusStr) => {
  if (!statusStr) return "PENDING APPROVAL";
  return statusStr.replace(/_/g, " ").toUpperCase();
};

const getPriorityStyle = (priority) => {
  switch (priority?.toUpperCase()) {
    case "URGENT":
    case "HIGH":
      return "bg-rose-100/80 text-rose-700 border-rose-200/80";
    case "LOW":
      return "bg-slate-100/80 text-slate-600 border-slate-200/80";
    default:
      return "bg-blue-100/70 text-blue-700 border-blue-200/80";
  }
};

const matchesSearch = (query, term) => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return Boolean(
    query.queryId?.toLowerCase().includes(needle) ||
      query.subject?.toLowerCase().includes(needle) ||
      query.inquirer?.name?.toLowerCase().includes(needle),
  );
};

/** Free-text search plus the priority narrowing. */
function QueryTableToolbar({
  searchQuery,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
}) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6">
      <div className="relative flex-1 w-full">
        <label htmlFor="query-table-search" className="sr-only">
          Search queries
        </label>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
        <input
          id="query-table-search"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search queries by ID, subject, or inquirer..."
          className="w-full rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-11 pr-4 py-3 text-[13.5px] font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
        />
      </div>

      <div className="relative w-full sm:w-56 shrink-0">
        <select
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(e) => onPriorityChange(e.target.value)}
          className="w-full appearance-none rounded-2xl bg-slate-50/70 border border-slate-200/70 pl-10 pr-10 py-3 text-[13.5px] font-bold text-slate-700 cursor-pointer hover:bg-slate-100/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Filter className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

function QueryTableHeaderRow() {
  return (
    <div
      className={`grid ${GRID} gap-3 px-6 py-3.5 bg-[#f9f9fe] border-b border-slate-100/80 rounded-2xl text-[12px] font-extrabold text-slate-700 tracking-wider`}
    >
      {COLUMNS.map(({ label, center }) => (
        <div
          key={label}
          className={`flex items-center gap-1.5${center ? " justify-center" : ""}`}
        >
          <span>{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
        </div>
      ))}
      <span></span>
    </div>
  );
}

/** Who the case currently sits with, as shown in the Assignee column. */
function describeAssignee(query) {
  const assignee = query.currentAssigneeId
    ? findUserById(query.currentAssigneeId)
    : null;
  const name = assignee?.name || query.inquirer?.name || "Unassigned";

  let role;
  if (assignee?.role) role = ROLE_LABELS[assignee.role];
  else if (query.inquirer) role = "Inquirer";
  else role = "Assigned Official";

  const initials =
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "Q";

  return { name, role, initials };
}

function formatReceived(createdAt) {
  const createdDate = createdAt ? new Date(createdAt) : null;
  if (!createdDate) return { date: "—", time: "—" };
  return {
    date: createdDate.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: createdDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function QueryRow({ query, to }) {
  const assignee = describeAssignee(query);
  const received = formatReceived(query.createdAt);

  return (
    <Link
      to={to}
      className={`group relative grid ${GRID} items-center gap-3 bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:shadow-md hover:border-purple-200 transition-[border-color,box-shadow] overflow-hidden cursor-pointer`}
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
          {query.subject || "(No Subject)"}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 mt-0.5">
          <Mail className="h-3.5 w-3.5 text-purple-500" />
          <span>Mail received</span>
        </div>
      </div>

      <div className="flex justify-center">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11.5px] font-extrabold border shadow-2xs ${getPriorityStyle(query.priority)}`}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
          {query.priority || "NORMAL"}
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
          {assignee.initials}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-800 truncate">
            {assignee.name}
          </div>
          <div className="text-[11px] font-medium text-slate-400 truncate">
            {assignee.role}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <span>{received.date}</span>
        </div>
        <div className="text-[11px] font-medium text-slate-400 pl-5 mt-0.5">
          {received.time}
        </div>
      </div>

      <div className="flex justify-end">
        <div className="p-1 rounded-lg text-slate-400 group-hover:text-slate-600 transition-colors">
          <MoreVertical className="h-4.5 w-4.5" />
        </div>
      </div>
    </Link>
  );
}

function QueryTableEmpty({ emptyMessage }) {
  return (
    <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
      <Inbox className="mx-auto h-10 w-10 text-slate-300 mb-2" />
      <p className="font-bold text-[14px] text-slate-700">
        No matching queries found
      </p>
      <p className="text-[12.5px] text-slate-400 mt-1">
        {emptyMessage || "Try adjusting your search or priority filter."}
      </p>
    </div>
  );
}

/** One static page for now; the control is present so the count reads clearly. */
function QueryTablePagination({ shown, total }) {
  return (
    <div className="px-6 py-4 border-t border-slate-100/80 flex items-center justify-between bg-white">
      <span className="text-[13px] font-medium text-slate-500">
        Showing {shown} of {total} result{total === 1 ? "" : "s"}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled
          aria-label="Previous page"
          className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 opacity-50 cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Go to page 1"
          aria-current="page"
          className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-blue-600 text-white font-extrabold text-[13px] shadow-md shadow-blue-500/20"
        >
          1
        </button>
        <button
          type="button"
          disabled
          aria-label="Next page"
          className="flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-slate-100/70 text-slate-400 opacity-50 cursor-not-allowed"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function QueryTable({
  title,
  purpose,
  breadcrumbItems,
  detailPath,
  filter,
  actions,
  emptyMessage,
  greeting = "IPC Query Registry 📋",
  icon = null,
  iconClassName,
}) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const allQueries = useWorkflowStore((state) => state.queries);
  const queries = filter ? allQueries.filter(filter) : allQueries;

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");

  const filteredQueries = queries.filter(
    (q) =>
      matchesSearch(q, searchQuery) &&
      (priorityFilter === "ALL" || q.priority === priorityFilter),
  );

  const getQueryDetailPath = (queryId) => {
    if (detailPath) {
      return buildPath(detailPath, { queryId });
    }
    const slug = ROLE_SLUG[currentUser?.role] || "officer-in-charge";
    return `/${slug}/queries/${queryId}`;
  };

  return (
    <div className="space-y-6">
      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      <PageHeader
        greeting={greeting}
        title={title || "Queries"}
        purpose={purpose || "All registered queries across the organization."}
        actions={actions}
        icon={icon}
        iconClassName={iconClassName}
      />

      <div className="bg-white rounded-3xl border border-slate-200/70 overflow-hidden shadow-sm flex flex-col justify-between">
        <div className="p-6">
          <QueryTableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            priorityFilter={priorityFilter}
            onPriorityChange={setPriorityFilter}
          />

          <QueryTableHeaderRow />

          <div className="space-y-3.5 mt-3.5">
            {filteredQueries.length > 0 ? (
              filteredQueries.map((query) => (
                <QueryRow
                  key={query.queryId}
                  query={query}
                  to={getQueryDetailPath(query.queryId)}
                />
              ))
            ) : (
              <QueryTableEmpty emptyMessage={emptyMessage} />
            )}
          </div>
        </div>

        <QueryTablePagination
          shown={filteredQueries.length}
          total={queries.length}
        />
      </div>
    </div>
  );
}
