import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatTile } from "@/components/common/StatTile";
import { DashboardQueryList } from "@/components/dashboard/DashboardQueryList";
import { HeroBannerCard } from "@/components/dashboard/HeroBannerCard";
import {
  bucketsForRole,
  defaultBucketKey,
  visibleQueries,
} from "@/constants/queryBuckets";
import { getTimeBasedGreeting } from "@/utils/greeting";
import { cn } from "@/utils/cn";

const TONES = {
  total: "blue",
  open: "amber",
  incoming: "blue",
  assigned: "blue",
  inProgress: "sky",
  pendingAssignment: "amber",
  awaitingAssignment: "amber",
  awaitingFinalApproval: "purple",
  awaitingReview: "amber",
  drafting: "amber",
  awaitingDispatch: "purple",
  submitted: "purple",
  returned: "rose",
  returnedByMe: "rose",
  closed: "emerald",
  dispatched: "emerald",
  approved: "emerald",
  approvedByMe: "emerald",
  completed: "emerald",
};

const TONE_STYLES = {
  blue: {
    cardBg: "linear-gradient(180deg, #dbeafe 0%, #ffffff 100%)",
    cardBorder: "#93c5fd",
    numColor: "#1d4ed8",
    subtextColor: "text-blue-700",
    badgeBg: "bg-blue-100 text-blue-800 border-blue-300",
    iconBg:
      "bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-blue-500/25",
    accentColor: "blue",
  },
  amber: {
    cardBg: "linear-gradient(180deg, #fef3c7 0%, #ffffff 100%)",
    cardBorder: "#fde68a",
    numColor: "#d97706",
    subtextColor: "text-amber-700",
    badgeBg: "bg-amber-100 text-amber-800 border-amber-300",
    iconBg:
      "bg-gradient-to-tr from-amber-500 to-orange-500 text-white shadow-amber-500/25",
    accentColor: "amber",
  },
  sky: {
    cardBg: "linear-gradient(180deg, #e0f2fe 0%, #ffffff 100%)",
    cardBorder: "#7dd3fc",
    numColor: "#0284c7",
    subtextColor: "text-sky-700",
    badgeBg: "bg-sky-100 text-sky-800 border-sky-300",
    iconBg:
      "bg-gradient-to-tr from-sky-500 to-blue-500 text-white shadow-sky-500/25",
    accentColor: "sky",
  },
  purple: {
    cardBg: "linear-gradient(180deg, #f3e8ff 0%, #ffffff 100%)",
    cardBorder: "#d8b4fe",
    numColor: "#9333ea",
    subtextColor: "text-purple-700",
    badgeBg: "bg-purple-100 text-purple-800 border-purple-300",
    iconBg:
      "bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-purple-500/25",
    accentColor: "purple",
  },
  rose: {
    cardBg: "linear-gradient(180deg, #ffe4e6 0%, #ffffff 100%)",
    cardBorder: "#fca5a5",
    numColor: "#e11d48",
    subtextColor: "text-rose-700",
    badgeBg: "bg-rose-100 text-rose-800 border-rose-300",
    iconBg:
      "bg-gradient-to-tr from-rose-500 to-red-600 text-white shadow-rose-500/25",
    accentColor: "rose",
  },
  emerald: {
    cardBg: "linear-gradient(180deg, #d1fae5 0%, #ffffff 100%)",
    cardBorder: "#6ee7b7",
    numColor: "#059669",
    subtextColor: "text-emerald-700",
    badgeBg: "bg-emerald-100 text-emerald-800 border-emerald-300",
    iconBg:
      "bg-gradient-to-tr from-emerald-500 to-teal-600 text-white shadow-emerald-500/25",
    accentColor: "emerald",
  },
  slate: {
    cardBg: "linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%)",
    cardBorder: "#cbd5e1",
    numColor: "#334155",
    subtextColor: "text-slate-700",
    badgeBg: "bg-slate-100 text-slate-800 border-slate-300",
    iconBg:
      "bg-gradient-to-tr from-slate-600 to-slate-800 text-white shadow-slate-500/25",
    accentColor: "slate",
  },
};

const styleFor = (key) => TONE_STYLES[TONES[key]] || TONE_STYLES.slate;

export function BucketDashboard({
  role,
  currentUser,
  queries,
  workflowSteps = [],
  reviews = [],
  title,
  purpose,
  actions,
  sidePanel,
  emptyTextFor,
}) {
  const buckets = bucketsForRole(role);
  const [selectedKey, setSelectedKey] = useState(() => defaultBucketKey(role));

  const ctx = useMemo(
    () => ({ user: currentUser, workflowSteps, reviews }),
    [currentUser, workflowSteps, reviews],
  );

  const visible = useMemo(
    () => visibleQueries(queries, role, ctx),
    [queries, role, ctx],
  );

  const recordsByKey = useMemo(() => {
    const map = {};
    for (const bucket of buckets) {
      map[bucket.key] = visible.filter((query) => bucket.predicate(query, ctx));
    }
    return map;
  }, [buckets, visible, ctx]);

  const selected =
    buckets.find((b) => b.key === selectedKey) || buckets[0] || null;
  const rows = selected ? recordsByKey[selected.key] || [] : [];

  const gridColsClass = useMemo(() => {
    const len = buckets.length;
    if (len >= 6) return "xl:grid-cols-6";
    if (len === 5) return "xl:grid-cols-5";
    if (len === 4) return "xl:grid-cols-4";
    if (len === 3) return "xl:grid-cols-3";
    return "xl:grid-cols-4";
  }, [buckets.length]);

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title={title}
        purpose={purpose}
        actions={actions}
      />

      <HeroBannerCard role={role} userName={currentUser?.name} />

      <div
        className={cn(
          "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 lg:gap-3.5 items-stretch",
          gridColsClass,
        )}
      >
        {buckets.map((bucket) => {
          const count = recordsByKey[bucket.key]?.length ?? 0;
          const tone = styleFor(bucket.key);

          return (
            <StatTile
              key={bucket.key}
              label={bucket.label}
              caption={bucket.caption}
              value={count}
              icon={bucket.icon}
              selected={selected?.key === bucket.key}
              onClick={() => setSelectedKey(bucket.key)}
              subtextMain={`${count} ${count === 1 ? "query" : "queries"}`}
              {...tone}
            />
          );
        })}
      </div>

      <div
        className={
          sidePanel
            ? "grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-4"
            : "grid grid-cols-1 gap-4"
        }
      >
        <DashboardQueryList
          title={selected?.label || "Queries"}
          subtitle={selected?.caption}
          icon={selected?.icon || FileText}
          items={rows}
          totalCount={visible.length}
          emptyText={
            emptyTextFor?.(selected) ||
            `Nothing in ${selected?.label || "this list"} right now.`
          }
        />

        {sidePanel && (
          <div className="sticky top-6 self-start">{sidePanel}</div>
        )}
      </div>
    </div>
  );
}
