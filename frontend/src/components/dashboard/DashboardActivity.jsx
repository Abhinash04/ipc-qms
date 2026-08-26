import {
  Activity,
  XCircle,
  Pencil,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { AUDIT_EVENT, AUDIT_EVENT_LABELS } from "@/constants/statusEnums";

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

export function DashboardActivity({ auditEvents = [] }) {
  const activity = newestFirst(auditEvents).slice(0, 5);

  const getEventBadge = (event) => {
    switch (event) {
      case AUDIT_EVENT.FINAL_APPROVAL_REJECTED:
      case AUDIT_EVENT.REVISION_REQUESTED:
        return {
          icon: XCircle,
          bg: "bg-rose-50 text-rose-600 border-rose-200/80",
        };
      case AUDIT_EVENT.QUERY_CLOSED:
      case AUDIT_EVENT.FINAL_APPROVAL_GRANTED:
        return {
          icon: CheckCircle2,
          bg: "bg-emerald-50 text-emerald-600 border-emerald-200/80",
        };
      default:
        return {
          icon: Pencil,
          bg: "bg-blue-50 text-blue-600 border-blue-200/80",
        };
    }
  };

  return (
    <div className="glass-panel aurora-panel bento-card rounded-[30px] border border-white/80 p-6 sm:p-7 shadow-lg flex flex-col justify-between h-full bg-white/95 backdrop-blur-xl">
      <div>
        <div className="flex items-center justify-between pb-6 mb-5 border-b border-slate-100/80">
          <div className="flex items-center gap-3.5">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 text-blue-600 border border-blue-200/50 shadow-2xs">
              <Activity className="h-6.5 w-6.5" strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="font-heading text-[22px] sm:text-[24px] font-black text-slate-900 m-0 leading-tight tracking-tight">
                Activity Feed ⚡
              </h3>
              <p className="text-[13px] font-medium text-slate-500 m-0 mt-0.5">
                Real-time workflow audit trail
              </p>
            </div>
          </div>

          <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3.5 py-1.5 text-[11.5px] font-extrabold text-blue-700 border border-blue-200/60 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            Live Audit
          </span>
        </div>

        <div className="relative pl-2 space-y-3.5 my-2">
          {activity.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50 flex flex-col items-center justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100/60 shadow-2xs mb-3">
                <Sparkles className="h-7 w-7" strokeWidth={1.8} />
              </div>
              <h4 className="font-heading text-[16px] font-extrabold text-slate-800 m-0">
                No Activity Yet
              </h4>
              <p className="text-[13px] font-medium text-slate-400 m-0 mt-1 max-w-xs">
                Workflow transitions and case updates will appear here
                automatically as they occur.
              </p>
            </div>
          ) : (
            activity.map((event, i) => {
              const badge = getEventBadge(event.event);
              const EventIcon = badge.icon;
              const label = AUDIT_EVENT_LABELS[event.event] || event.event;

              return (
                <div
                  key={event.auditId || i}
                  className="relative flex items-start gap-3.5 group"
                >
                  {i < activity.length - 1 && (
                    <div className="absolute left-4.75 top-9 bottom-0 w-0.5 bg-slate-100 z-0" />
                  )}

                  <div
                    className={`relative z-10 flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border shadow-2xs ${badge.bg}`}
                  >
                    <EventIcon className="h-4.5 w-4.5" strokeWidth={2} />
                  </div>

                  <div className="flex-1 bg-slate-50/60 rounded-2xl border border-slate-100 p-3 shadow-2xs hover:shadow-xs hover:border-blue-200 transition-all">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-heading text-[12.5px] font-black text-purple-700">
                        {event.queryId}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400 shrink-0">
                        {relativeTime(event.at)}
                      </span>
                    </div>

                    <p className="text-[13px] font-extrabold text-slate-800 m-0 mt-1 leading-snug">
                      {label}
                    </p>

                    {event.actor && (
                      <p className="text-[11.5px] font-medium text-slate-400 m-0 mt-1 flex items-center gap-1">
                        <span>by</span>
                        <strong className="text-slate-600 font-bold">
                          {event.actor}
                        </strong>
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
