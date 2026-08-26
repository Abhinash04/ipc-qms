import { useMemo, useState } from "react";
import { FileText } from "lucide-react";

import { PageHeader } from "@/components/common/PageHeader";
import { StatTile } from "@/components/common/StatTile";
import { DashboardQueryList } from "@/components/dashboard/DashboardQueryList";
import {
  bucketsForRole,
  defaultBucketKey,
  visibleQueries,
} from "@/constants/queryBuckets";
import { getTimeBasedGreeting } from "@/utils/greeting";

const TONES = {
  total: "slate",
  open: "blue",
  incoming: "blue",
  assigned: "blue",
  inProgress: "blue",
  pendingAssignment: "amber",
  awaitingAssignment: "amber",
  awaitingFinalApproval: "amber",
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
    cardBg: "linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)",
    cardBorder: "#bfdbfe",
    numColor: "#2563eb",
    subtextColor: "text-blue-600",
    illustrationType: "assigned",
  },
  amber: {
    cardBg: "linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)",
    cardBorder: "#fde68a",
    numColor: "#d97706",
    subtextColor: "text-amber-600",
    illustrationType: "drafting",
  },
  purple: {
    cardBg: "linear-gradient(180deg, #faf5ff 0%, #ffffff 100%)",
    cardBorder: "#e9d5ff",
    numColor: "#9333ea",
    subtextColor: "text-purple-600",
    illustrationType: "review",
  },
  rose: {
    cardBg: "linear-gradient(180deg, #fff5f6 0%, #ffffff 100%)",
    cardBorder: "#fecdd3",
    numColor: "#e11d48",
    subtextColor: "text-rose-600",
    illustrationType: "review",
  },
  emerald: {
    cardBg: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
    cardBorder: "#bbf7d0",
    numColor: "#059669",
    subtextColor: "text-emerald-600",
    illustrationType: "closed",
  },
  slate: {
    cardBg: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
    cardBorder: "#e2e8f0",
    numColor: "#475569",
    subtextColor: "text-slate-600",
    illustrationType: "assigned",
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

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={getTimeBasedGreeting(currentUser?.name)}
        title={title}
        purpose={purpose}
        actions={actions}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

        {sidePanel && <div className="sticky top-6 self-start">{sidePanel}</div>}
      </div>
    </div>
  );
}
