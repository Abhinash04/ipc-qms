import { Link } from "react-router-dom";
import {
  Hourglass,
  XCircle,
  User,
  ShieldCheck,
  Calendar,
  Info,
} from "lucide-react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { PageHeader } from "@/components/common/PageHeader";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ROLE_LABELS } from "@/constants/roles";
import { buildPath } from "@/constants/routePaths";
import { useRoutePaths } from "@/hooks/useRoutePaths";

export function NotificationsPage() {
  const paths = useRoutePaths();
  const notifications = useWorkflowStore((state) => state.notifications);

  const storeOrdered = [...notifications].sort(
    (a, b) => new Date(b.at) - new Date(a.at),
  );
  const displayList = storeOrdered;

  const getNodeConfig = (item) => {
    const msg = (item.message || "").toLowerCase();
    const role = item.recipientRole || "";

    if (item.type === "rejected" || msg.includes("rejected")) {
      return {
        icon: XCircle,
        boxBg: "bg-rose-50 text-rose-500 border-rose-200/60",
        dotBg: "bg-rose-500",
        badgeBg: "bg-rose-100/80 text-rose-800 border-rose-200/80",
      };
    }
    if (item.type === "user" || msg.includes("assigned to")) {
      return {
        icon: User,
        boxBg: "bg-blue-50 text-blue-600 border-blue-200/60",
        dotBg: "bg-blue-600",
        badgeBg: "bg-blue-100/80 text-blue-700 border-blue-200/80",
      };
    }
    if (
      item.type === "verified" ||
      msg.includes("front office") ||
      role === "FRONT_OFFICE"
    ) {
      return {
        icon: ShieldCheck,
        boxBg: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
        dotBg: "bg-emerald-600",
        badgeBg: "bg-emerald-100/80 text-emerald-800 border-emerald-200/80",
      };
    }
    return {
      icon: Hourglass,
      boxBg: "bg-amber-50 text-amber-500 border-amber-200/60",
      dotBg: "bg-amber-500",
      badgeBg: "bg-amber-100/80 text-amber-800 border-amber-200/80",
    };
  };

  const formatTimestamp = (isoString) => {
    try {
      const d = new Date(isoString);
      const dateStr = d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const timeStr = d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      return `${dateStr}, ${timeStr}`;
    } catch {
      return "19 Aug 2026, 03:10:19 PM";
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", path: paths.DASHBOARD },
          { label: "Notifications" },
        ]}
      />

      <PageHeader
        greeting="Live Alerts & Updates 🔔"
        title="Notification Center"
        purpose="Workflow events raised for the cases you are involved in"
      />

      <div className="bg-white rounded-3xl border border-slate-200/70 p-6 shadow-sm">
        <div className="relative pl-3 space-y-6 my-2">
          {displayList.map((item, index) => {
            const config = getNodeConfig(item);
            const Icon = config.icon;
            const roleLabel =
              ROLE_LABELS[item.recipientRole] || item.recipientRole;

            return (
              <div
                key={item.notificationId || index}
                className="relative flex items-center gap-4 group"
              >
                {index < displayList.length - 1 && (
                  <div className="absolute left-5.25 top-12 -bottom-6 w-0.5 border-l-2 border-dashed border-slate-200 z-0" />
                )}
                <div
                  className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-2xs ${config.boxBg}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </div>

                <div
                  className={`relative z-10 h-2.5 w-2.5 shrink-0 rounded-full ${config.dotBg} ring-4 ring-white`}
                />

                <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs hover:shadow-md hover:border-purple-200 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-slate-900 text-[14.5px] leading-snug m-0">
                      {item.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-0.5 text-[11px] font-extrabold border ${config.badgeBg}`}
                      >
                        {roleLabel}
                      </span>
                      <span className="text-slate-300 font-bold">•</span>
                      {item.queryId && (
                        <Link
                          to={buildPath(paths.QUERY_DETAIL, {
                            queryId: item.queryId,
                          })}
                          className="font-extrabold text-blue-600 hover:underline text-[12.5px]"
                        >
                          {item.queryId}
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400 shrink-0 self-start sm:self-center">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>{formatTimestamp(item.at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl bg-blue-50/50 p-4 flex items-start gap-3 border border-blue-100/60">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <Info className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-slate-700 m-0 leading-snug">
              Notifications are generated in-app as workflow transitions occur.
            </p>
            <p className="text-[12px] font-medium text-slate-400 m-0 mt-0.5">
              Real delivery infrastructure is not implemented — see
              docs/srs/10-notifications.md.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
