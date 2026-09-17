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
import { styleFor } from "@/components/dashboard/dashboardTones";
import { caseTrend, volumeByDay } from "@/components/admin/adminStats";
import { cn } from "@/utils/cn";

/** Stable empty defaults: one shared reference, so memo and dep arrays hold. */
const NO_WORKFLOW_STEPS = [];
const NO_REVIEWS = [];
const NO_RECORDS = [];

/**
 * What the trend actually measures.
 *
 * A bucket is a filter over a query's CURRENT state, so "this bucket grew by 3"
 * is not derivable — nothing here holds the history. What is derivable, and
 * what caseTrend computes, is how many of the cases sitting in the bucket right
 * now arrived in the last seven days against the seven before it.
 */
const TREND_LABEL = "arrivals, 7d vs prior 7d";

export function BucketDashboard({
  role,
  currentUser,
  queries,
  workflowSteps = NO_WORKFLOW_STEPS,
  reviews = NO_REVIEWS,
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

  const tileMetrics = useMemo(() => {
    const total = visible.length;
    const out = {};
    for (const bucket of buckets) {
      const records = recordsByKey[bucket.key] || NO_RECORDS;
      const series = volumeByDay(records);
      const { current, previous, delta } = caseTrend(records);
      out[bucket.key] = {
        // An aggregate bucket is always 100% of itself — a full bar says nothing.
        share: bucket.aggregate || total === 0 ? null : records.length / total,
        shareTotal: total,
        // A flat line and a "No change" chip both assert a measurement that did
        // not happen. Absent is the honest state.
        series: series.some((d) => d.value > 0) ? series : null,
        delta: current || previous ? delta : null,
      };
    }
    return out;
  }, [buckets, recordsByKey, visible.length]);

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
          const metrics = tileMetrics[bucket.key];

          return (
            <StatTile
              key={bucket.key}
              label={bucket.label}
              caption={bucket.caption}
              value={count}
              icon={bucket.icon}
              selected={selected?.key === bucket.key}
              onClick={() => setSelectedKey(bucket.key)}
              delta={metrics?.delta}
              higherIsWorse={bucket.higherIsWorse}
              neutralTrend={Boolean(bucket.aggregate)}
              comparisonLabel={TREND_LABEL}
              share={metrics?.share}
              shareTotal={metrics?.shareTotal}
              series={metrics?.series}
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
