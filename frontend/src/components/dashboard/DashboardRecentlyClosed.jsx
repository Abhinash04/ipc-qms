import { Link } from "react-router-dom";
import { CheckCircle2 as CheckCircle2Icon, PartyPopper } from "lucide-react";
import { buildPath } from "@/constants/routePaths";
import { useRoutePaths } from "@/hooks/useRoutePaths";

function relativeTime(iso) {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return then.toLocaleDateString();
}

export function DashboardRecentlyClosed({ recentlyClosed }) {
  const paths = useRoutePaths();

  return (
    <section
      aria-labelledby="recently-closed-title"
      className="rounded-2xl border border-transparent bg-surface shadow-card"
    >
      <div className="flex items-center gap-3 px-5 pt-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <CheckCircle2Icon className="h-5.5 w-5.5" strokeWidth={2.2} />
        </span>
        <div>
          <h2 id="recently-closed-title" className="font-heading text-[17px] font-semibold text-ink">
            Recently closed
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Closed queries appear here once a response has been dispatched.
          </p>
        </div>
      </div>

      <div className="px-5 pt-4 pb-5">
        {recentlyClosed.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-10 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <PartyPopper className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <div className="text-[15px] font-semibold text-ink">Nothing closed yet</div>
            <div className="mt-1 text-[12.5px] text-ink-muted">
              Once a query is closed, it will appear here.
            </div>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {recentlyClosed.map((item) => {
              const Row = paths.QUERY_DETAIL ? Link : "div";
              const rowProps = paths.QUERY_DETAIL
                ? { to: buildPath(paths.QUERY_DETAIL, { queryId: item.queryId }) }
                : {};
              return (
                <li key={item.queryId}>
                  <Row
                    {...rowProps}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <CheckCircle2Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-ink">{item.subject}</div>
                      <div className="mt-0.5 text-[11.5px] text-ink-muted">
                        {item.queryId} · {item.division}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11.5px] text-ink-muted">
                      {relativeTime(item.closedAt)}
                    </span>
                  </Row>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
