import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Filter,
  ChevronDown,
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
import { lifecycleProgress } from "@/components/dashboard/lifecycleProgress";
import { cn } from "@/utils/cn";

const GRID =
  "grid-cols-[minmax(220px,2fr)_110px_minmax(150px,1fr)_minmax(170px,1fr)_130px]";

const PAGE_SIZES = [10, 25, 50];

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All priorities" },
  { value: "URGENT", label: "Urgent" },
  { value: "HIGH", label: "High" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
];

const COLUMNS = ["Query", "Priority", "Status", "Assignee", "Received"];

const PRIORITY_STYLE = {
  URGENT: "bg-rose-50 text-rose-700",
  HIGH: "bg-rose-50 text-rose-700",
  LOW: "bg-slate-100 text-slate-600",
};

const formatStatus = (statusStr) =>
  (statusStr || "PENDING APPROVAL").replace(/_/g, " ").toLowerCase();

const matchesSearch = (query, term) => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return Boolean(
    query.queryId?.toLowerCase().includes(needle) ||
      query.subject?.toLowerCase().includes(needle) ||
      query.inquirer?.name?.toLowerCase().includes(needle),
  );
};

const CONTROL =
  "rounded-lg border border-line bg-surface text-[13px] text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function QueryTableToolbar({
  searchQuery,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
  pageSize,
  onPageSizeChange,
}) {
  return (
    <div className="flex flex-col gap-3 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-2 text-[13px] text-ink-muted">
        Show
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className={cn(CONTROL, "cursor-pointer px-2 py-1.5")}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        entries
      </label>

      <div className="flex flex-1 flex-col gap-3 sm:max-w-xl sm:flex-row sm:justify-end">
        <div className="relative flex-1">
          <label htmlFor="query-table-search" className="sr-only">
            Search queries
          </label>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            id="query-table-search"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by ID, subject or inquirer…"
            className={cn(CONTROL, "w-full py-2 ps-9 pe-3 placeholder:text-ink-muted")}
          />
        </div>

        <div className="relative sm:w-48">
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value)}
            className={cn(CONTROL, "w-full cursor-pointer appearance-none py-2 ps-9 pe-8 font-medium")}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Filter className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        </div>
      </div>
    </div>
  );
}

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
  const progress = lifecycleProgress(query.workflowState);
  const priority = (query.priority || "NORMAL").toUpperCase();

  return (
    <li>
      <Link
        to={to}
        className={cn(
          "group grid items-center gap-4 px-5 py-3.5 outline-none transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted",
          GRID,
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ink group-hover:text-primary">
            {query.subject || "(No Subject)"}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-ink-muted">{query.queryId}</div>
        </div>

        <div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold",
              PRIORITY_STYLE[priority] || "bg-primary-50 text-primary",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {priority}
          </span>
        </div>

        <div className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium capitalize text-ink-soft">
            {formatStatus(query.businessStatus || query.workflowState)}
          </span>
          <div className="mt-1.5 h-1.5 w-full max-w-36 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div
              className={cn("h-full rounded-full", progress.tone)}
              style={{ width: `${progress.fraction * 100}%` }}
            />
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[12px] font-semibold text-primary">
            {assignee.initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{assignee.name}</div>
            <div className="truncate text-[11.5px] text-ink-muted">{assignee.role}</div>
          </div>
        </div>

        <div>
          <div className="text-[13px] font-medium text-ink">{received.date}</div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">{received.time}</div>
        </div>
      </Link>
    </li>
  );
}

function QueryTableEmpty({ emptyMessage }) {
  return (
    <div className="mx-5 my-4 rounded-xl border border-dashed border-line p-12 text-center">
      <Inbox className="mx-auto mb-2 h-10 w-10 text-ink-muted/60" />
      <p className="text-[14px] font-semibold text-ink">No matching queries found</p>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        {emptyMessage || "Try adjusting your search or priority filter."}
      </p>
    </div>
  );
}

function pageWindow(current, count) {
  const pages = new Set([1, count, current - 1, current, current + 1]);
  return [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
}

function QueryTablePagination({ page, pageCount, from, to, total, onPage }) {
  const PAGE_BUTTON =
    "flex h-8.5 min-w-8.5 cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40";
  const pages = pageWindow(page, pageCount);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-5 py-4 sm:flex-row">
      <span className="text-[13px] text-ink-muted">
        {total === 0 ? "No results" : `Showing ${from} to ${to} of ${total} result${total === 1 ? "" : "s"}`}
      </span>

      <nav aria-label="Pagination" className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
          className={cn(PAGE_BUTTON, "border border-line text-ink-soft hover:bg-surface-muted")}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        {pages.map((p, i) => (
          <span key={p} className="flex items-center gap-1.5">
            {i > 0 && p - pages[i - 1] > 1 && (
              <span className="px-1 text-ink-muted" aria-hidden="true">
                …
              </span>
            )}
            <button
              type="button"
              aria-label={`Go to page ${p}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPage(p)}
              className={cn(
                PAGE_BUTTON,
                p === page
                  ? "bg-primary text-white shadow-sm"
                  : "border border-line text-ink-soft hover:bg-surface-muted",
              )}
            >
              {p}
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
          className={cn(PAGE_BUTTON, "border border-line text-ink-soft hover:bg-surface-muted")}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </nav>
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
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const filteredQueries = queries.filter(
    (q) =>
      matchesSearch(q, searchQuery) &&
      (priorityFilter === "ALL" || q.priority === priorityFilter),
  );

  const pageCount = Math.max(1, Math.ceil(filteredQueries.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const pageRows = filteredQueries.slice(start, start + pageSize);

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

      <section
        aria-label={`${title || "Queries"} list`}
        className="overflow-hidden rounded-2xl border border-transparent bg-surface shadow-card dark:border-line/60"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
          <h2 className="font-heading text-[17px] font-semibold text-ink">Records</h2>
          <span className="rounded-full bg-primary-50 px-3 py-1 text-[12px] font-semibold text-primary">
            {queries.length} total
          </span>
        </div>

        <QueryTableToolbar
          searchQuery={searchQuery}
          onSearchChange={(value) => {
            setSearchQuery(value);
            setPage(1);
          }}
          priorityFilter={priorityFilter}
          onPriorityChange={(value) => {
            setPriorityFilter(value);
            setPage(1);
          }}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />

        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div
              className={cn(
                "grid gap-4 border-y border-line bg-surface-muted px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted",
                GRID,
              )}
            >
              {COLUMNS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            {pageRows.length > 0 ? (
              <ul className="divide-y divide-line">
                {pageRows.map((query) => (
                  <QueryRow
                    key={query.queryId}
                    query={query}
                    to={getQueryDetailPath(query.queryId)}
                  />
                ))}
              </ul>
            ) : (
              <QueryTableEmpty emptyMessage={emptyMessage} />
            )}
          </div>
        </div>

        <QueryTablePagination
          page={current}
          pageCount={pageCount}
          from={filteredQueries.length ? start + 1 : 0}
          to={start + pageRows.length}
          total={filteredQueries.length}
          onPage={setPage}
        />
      </section>
    </div>
  );
}
