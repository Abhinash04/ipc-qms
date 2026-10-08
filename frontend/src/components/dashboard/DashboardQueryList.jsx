import { Link } from "react-router-dom";
import { FileText, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { ROLE_SLUG } from "@/constants/permissions";
import { useAuthStore } from "@/store/useAuthStore";
import { lifecycleProgress } from "@/components/dashboard/lifecycleProgress";
import { cn } from "@/utils/cn";

const PRIORITY_STYLE = {
  URGENT: "bg-rose-50 text-rose-700",
  HIGH: "bg-rose-50 text-rose-700",
  LOW: "bg-slate-100 text-slate-600",
};

const AVATAR_TONES = [
  "bg-primary-50 text-primary",
  "bg-sky-50 text-sky-600",
  "bg-amber-50 text-amber-600",
  "bg-emerald-50 text-emerald-600",
  "bg-purple-50 text-purple-600",
];

function avatarTone(id) {
  const sum = [...String(id)].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const GRID = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_minmax(0,1fr)] md:items-center md:gap-4";

export function DashboardQueryList({
  title,
  subtitle,
  icon: Icon = FileText,
  items = [],
  emptyText = "No items right now.",
  totalCount = 0,
  statusBadgeLabel,
}) {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);

  const detailPath = (queryId) => {
    if (paths.QUERY_DETAIL) return paths.QUERY_DETAIL.replace(":queryId", queryId);
    const slug = ROLE_SLUG[currentUser?.role] || "front-officer";
    return `/${slug}/queries/${queryId}`;
  };

  return (
    <section
      data-slot="dashboard-query-list"
      aria-labelledby="dashboard-query-list-title"
      className="bento-card flex flex-col rounded-2xl border border-transparent bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2
              id="dashboard-query-list-title"
              className="font-heading text-[17px] font-semibold leading-tight text-ink"
            >
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-muted">{subtitle}</p>}
          </div>
        </div>
        <span className="rounded-full bg-primary-50 px-3 py-1 text-[12px] font-semibold text-primary">
          {totalCount > 0 && items.length !== totalCount
            ? `${items.length} of ${totalCount}`
            : `${items.length} ${items.length === 1 ? "query" : "queries"}`}
        </span>
      </div>

      {items.length > 0 && (
        <div
          className={cn(
            "hidden border-y border-line bg-surface-muted px-5 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted",
            GRID,
          )}
        >
          <span>Query</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Progress</span>
        </div>
      )}

      <ScrollArea className="max-h-105 min-w-0 [&>[data-radix-scroll-area-viewport]>div]:block!">
        {items.length === 0 ? (
          <div className="mx-5 my-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-12 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary">
              <Sparkles className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <h3 className="m-0 font-heading text-[15px] font-semibold text-ink">All caught up</h3>
            <p className="m-0 mt-1 max-w-sm text-[13px] text-ink-muted">{emptyText}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((query) => {
              const statusText = statusBadgeLabel
                ? statusBadgeLabel(query)
                : (query.businessStatus || query.workflowState || "PENDING")
                    .replace(/_/g, " ")
                    .toLowerCase();
              const progress = lifecycleProgress(query.workflowState);
              const priority = (query.priority || "NORMAL").toUpperCase();

              return (
                <li key={query.queryId}>
                  <Link
                    to={detailPath(query.queryId)}
                    className={cn(
                      "group flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted outline-none",
                      GRID,
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                          avatarTone(query.queryId),
                        )}
                      >
                        {(query.subject || query.queryId).trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold text-ink group-hover:text-primary">
                          {query.subject || "(No Subject)"}
                        </div>
                        <div className="truncate text-[12px] text-ink-muted">
                          <span className="font-mono">{query.queryId}</span> · {formatDate(query.createdAt)}
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <span className="inline-flex max-w-full items-center truncate rounded-md bg-primary-50 px-2 py-1 text-[11.5px] font-semibold capitalize text-primary">
                        {statusText}
                      </span>
                    </div>

                    <div>
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                          PRIORITY_STYLE[priority] || "bg-primary-50 text-primary-700",
                        )}
                      >
                        {priority}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between text-[11.5px] text-ink-muted">
                        <span className="truncate">{progress.label}</span>
                      </div>
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
                        role="img"
                        aria-label={`Lifecycle stage ${progress.step} of ${progress.steps}: ${progress.label}`}
                      >
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-700",
                            progress.tone,
                          )}
                          style={{ width: `${progress.fraction * 100}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="border-t border-line px-5 py-3 text-[12.5px] text-ink-muted">
        Showing <strong className="font-semibold text-ink">{items.length}</strong> of{" "}
        <strong className="font-semibold text-ink">{totalCount || items.length}</strong> total item
        {totalCount === 1 ? "" : "s"}
      </div>
    </section>
  );
}
