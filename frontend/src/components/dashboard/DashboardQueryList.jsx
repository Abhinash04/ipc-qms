import { Link } from "react-router-dom";
import {
  Inbox,
  FileText,
  Mail,
  Clock,
  ShieldCheck,
  Info,
  Sparkles,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { ROLE_SLUG } from "@/constants/permissions";
import { useAuthStore } from "@/store/useAuthStore";

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

  const getQueryDetailPath = (queryId) => {
    if (paths.QUERY_DETAIL) {
      return paths.QUERY_DETAIL.replace(":queryId", queryId);
    }
    const slug = ROLE_SLUG[currentUser?.role] || "front-officer";
    return `/${slug}/queries/${queryId}`;
  };

  const getPriorityStyle = (priority) => {
    switch (priority?.toUpperCase()) {
      case "URGENT":
      case "HIGH":
        return "bg-rose-100/90 text-rose-700 border-rose-200";
      case "LOW":
        return "bg-slate-100 text-slate-600 border-slate-200";
      default:
        return "bg-blue-100/80 text-blue-700 border-blue-200";
    }
  };

  return (
    <div className="glass-panel aurora-panel bento-card rounded-[30px] border border-white/80 p-6 sm:p-7 shadow-lg flex flex-col justify-between h-full bg-white/95 backdrop-blur-xl">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-5 border-b border-slate-100/80">
          <div className="flex items-center gap-4">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500/10 via-indigo-500/10 to-blue-500/10 text-purple-700 border border-purple-200/50 shadow-2xs">
              <Icon className="h-6.5 w-6.5" strokeWidth={2} />
            </div>
            <div>
              <h2 className="font-heading text-[24px] sm:text-[28px] font-black text-slate-900 m-0 leading-tight tracking-tight">
                {title}
              </h2>
              {subtitle && (
                <p className="m-0 text-[13.5px] font-medium text-slate-500 mt-1">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-4 py-1.5 text-[12.5px] font-extrabold text-purple-700 border border-purple-200/60 shadow-2xs">
              <Inbox className="h-4 w-4 text-purple-600" />
              {items.length} {items.length === 1 ? "listed" : "listed"}
            </span>
          </div>
        </div>

        {items.length > 0 && (
          <div className="hidden md:grid grid-cols-[140px_1fr_180px_120px] gap-3 px-5 py-3 bg-slate-50/80 border border-slate-100 rounded-2xl text-[11px] font-extrabold text-slate-400 tracking-wider uppercase mb-3">
            <span>Query ID</span>
            <span>Subject / Enquiry</span>
            <span className="text-center">Status</span>
            <span className="text-center">Priority</span>
          </div>
        )}

        <ScrollArea className="max-h-120 min-w-0 [&>[data-radix-scroll-area-viewport]>div]:block!">
          <div className="space-y-3 pr-3">
            {items.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50 flex flex-col items-center justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-purple-600 border border-purple-100/60 shadow-2xs mb-3">
                <Sparkles className="h-7 w-7" strokeWidth={1.8} />
              </div>
              <h4 className="font-heading text-[16px] font-extrabold text-slate-800 m-0">
                All Caught Up!
              </h4>
              <p className="text-[13px] font-medium text-slate-400 m-0 mt-1 max-w-sm">
                {emptyText}
              </p>
            </div>
          ) : (
            items.map((query) => {
              const formattedDate = query.createdAt
                ? new Date(query.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";
              const formattedTime = query.createdAt
                ? new Date(query.createdAt).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";

              const statusText = statusBadgeLabel
                ? statusBadgeLabel(query)
                : (
                    query.businessStatus ||
                    query.workflowState ||
                    "PENDING APPROVAL"
                  )
                    .replace(/_/g, " ")
                    .toUpperCase();

              return (
                <Link
                  key={query.queryId}
                  to={getQueryDetailPath(query.queryId)}
                  className="group relative flex flex-col md:grid md:grid-cols-[140px_1fr_180px_120px] md:items-center gap-3 bg-white rounded-2xl border border-slate-200/70 p-3.5 shadow-2xs hover:shadow-md hover:border-purple-300 transition-all duration-200 cursor-pointer overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-b from-purple-500 to-indigo-600 rounded-l-2xl" />
                  
                  <div className="flex items-center justify-between min-w-0 md:justify-start w-full md:w-auto pl-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 border border-purple-100/60">
                        <FileText className="h-4.5 w-4.5" strokeWidth={2} />
                      </div>
                      <span className="font-heading text-[13px] font-black text-purple-700 group-hover:underline truncate">
                        {query.queryId}
                      </span>
                    </div>
                    <div className="md:hidden flex shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9.5px] font-extrabold border shadow-2xs ${getPriorityStyle(query.priority)}`}
                      >
                        {query.priority || "NORMAL"}
                      </span>
                    </div>
                  </div>
                  
                  <div className="min-w-0 px-2 md:px-1 w-full md:w-auto">
                    <div className="text-[13.5px] font-extrabold text-slate-900 truncate group-hover:text-purple-700 transition-colors">
                      {query.subject || "(No Subject)"}
                    </div>
                    <div className="flex items-center gap-2 text-[11.5px] font-medium text-slate-400 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <Mail className="h-3 w-3 text-purple-500" />
                        Received {formattedDate}
                      </span>
                      <span className="shrink-0">•</span>
                      <span className="shrink-0">{formattedTime}</span>
                    </div>
                  </div>

                  <div className="flex px-2 md:px-0 md:justify-center w-full md:w-auto mt-1 md:mt-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50/90 px-3.5 py-1 text-[11px] font-extrabold text-purple-700 border border-purple-200/80 shadow-2xs truncate max-w-full">
                      <Clock className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                      <span className="truncate">{statusText}</span>
                    </span>
                  </div>

                  <div className="hidden md:flex justify-center">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold border shadow-2xs ${getPriorityStyle(query.priority)}`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      {query.priority || "NORMAL"}
                    </span>
                  </div>
                </Link>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[12.5px] font-semibold text-slate-500">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-purple-600 shrink-0" />
          <span>
            Showing <strong className="text-slate-800">{items.length}</strong>{" "}
            of{" "}
            <strong className="text-slate-800">
              {totalCount || items.length}
            </strong>{" "}
            total item{totalCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
