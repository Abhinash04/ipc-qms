import { Activity, FileText, XCircle, Pencil } from 'lucide-react';
import { AUDIT_EVENT, AUDIT_EVENT_LABELS } from '@/constants/statusEnums';

function relativeTime(iso) {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return then.toLocaleDateString();
}

function newestFirst(events) {
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function DashboardActivity({ auditEvents }) {
  const activity = newestFirst(auditEvents).slice(0, 5);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/70 p-6 shadow-sm flex flex-col justify-between h-full">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100/60 shadow-2xs">
              <Activity className="h-7 w-7" strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Activity feed</h3>
              <p className="text-[14px] font-normal text-slate-400 m-0 mt-1">
                Stay updated with the latest actions and progress.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-xl border border-blue-200/80 bg-blue-50/80 px-4 py-2 text-[12.5px] font-bold text-blue-600 hover:bg-blue-100 transition-colors shadow-2xs cursor-pointer"
          >
            <FileText className="h-4 w-4 text-blue-600" />
            Audit trail
          </button>
        </div>

        <div className="relative pl-3 space-y-0 my-2">
          {activity.length === 0 ? (
            <p className="py-6 text-center text-[13px] font-medium text-slate-400">
              No activity yet. Every workflow transition appears here as it happens.
            </p>
          ) : (
            activity.map((event, i) => (
              <div key={event.auditId} className="relative flex items-center gap-4 py-3 border-b border-slate-100/70 last:border-none">
                {i < activity.length - 1 && (
                  <div className="absolute left-4.75 top-10 -bottom-3 w-0.5 bg-slate-100 z-0" />
                )}

                <div className="relative z-10 shrink-0">
                  {event.event === AUDIT_EVENT.FINAL_APPROVAL_REJECTED ||
                    event.event === AUDIT_EVENT.REVISION_REQUESTED ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 border border-red-100">
                      <XCircle className="h-5 w-5" strokeWidth={2} />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                      <Pencil className="h-4.5 w-4.5" strokeWidth={2} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] leading-snug">
                    <span className="font-extrabold text-blue-600">{event.queryId}</span>
                    <span className="font-bold text-slate-800">
                      {' '}— {AUDIT_EVENT_LABELS[event.event] || event.event}
                    </span>
                  </div>
                  <div className="text-[12px] font-medium text-slate-400 mt-0.5">
                    {event.actor}
                  </div>
                </div>

                <div className="text-[12px] font-medium text-slate-400 shrink-0">
                  {relativeTime(event.at)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
