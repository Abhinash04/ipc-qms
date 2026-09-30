import { CheckCircle2, Pencil, Sparkles, XCircle } from "lucide-react";
import { AUDIT_EVENT, AUDIT_EVENT_LABELS } from "@/constants/statusEnums";
import { stableKey } from "@/utils/stableKey";
import { useT } from "@/i18n/useT";

function relativeTime(iso) {
  if (!iso) return "Recently";
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return then.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function newestFirst(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

function badgeFor(event) {
  switch (event) {
    case AUDIT_EVENT.FINAL_APPROVAL_REJECTED:
    case AUDIT_EVENT.REVISION_REQUESTED:
      return { icon: XCircle, dot: "border-rose-500 text-rose-500" };
    case AUDIT_EVENT.QUERY_CLOSED:
    case AUDIT_EVENT.FINAL_APPROVAL_GRANTED:
      return { icon: CheckCircle2, dot: "border-emerald-500 text-emerald-500" };
    default:
      return { icon: Pencil, dot: "border-primary text-primary" };
  }
}

export function DashboardActivity({ auditEvents = [] }) {
  const t = useT();
  const activity = newestFirst(auditEvents).slice(0, 5);

  return (
    <section
      aria-labelledby="dashboard-activity-title"
      className="rounded-2xl border border-transparent bg-surface shadow-card dark:border-line/60"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 id="dashboard-activity-title" className="font-heading text-[17px] font-semibold text-ink">
            {t("dashboard.activity")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">Latest workflow audit events</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          Live
        </span>
      </div>

      <div className="px-5 pt-4 pb-5">
        {activity.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary">
              <Sparkles className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <h3 className="m-0 font-heading text-[15px] font-semibold text-ink">No activity yet</h3>
            <p className="m-0 mt-1 max-w-xs text-[13px] text-ink-muted">
              Workflow transitions and case updates will appear here as they occur.
            </p>
          </div>
        ) : (
          <ol className="relative ms-2 border-s-2 border-dashed border-line">
            {activity.map((event) => {
              const badge = badgeFor(event.event);
              const Icon = badge.icon;
              const label = AUDIT_EVENT_LABELS[event.event] || event.event;
              return (
                <li key={event.auditId || stableKey(event)} className="relative ps-6 pb-5 last:pb-0">
                  <span
                    className={`absolute -start-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-surface ${badge.dot}`}
                    aria-hidden="true"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-muted">{relativeTime(event.at)}</span>
                  </div>
                  <p className="m-0 mt-0.5 text-[12px] text-ink-muted">
                    {event.queryId && (
                      <span className="font-mono font-semibold text-primary">{event.queryId}</span>
                    )}
                    {event.actor && (
                      <>
                        {event.queryId ? " · " : ""}by{" "}
                        <span className="font-medium text-ink-soft">{event.actor}</span>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
