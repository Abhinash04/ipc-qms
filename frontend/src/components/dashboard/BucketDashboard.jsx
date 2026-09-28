import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { StatTile } from "@/components/common/StatTile";
import { DashboardQueryList } from "@/components/dashboard/DashboardQueryList";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import {
  StageBreakdownCard,
  StatusMixCard,
  VolumeChartCard,
} from "@/components/dashboard/DashboardCharts";
import {
  bucketsForRole,
  defaultBucketKey,
  visibleQueries,
} from "@/constants/queryBuckets";
import { styleFor } from "@/components/dashboard/dashboardTones";
import { caseTrend } from "@/components/admin/adminStats";
import { cn } from "@/utils/cn";

const NO_WORKFLOW_STEPS = [];
const NO_REVIEWS = [];
const NO_RECORDS = [];

const TREND_LABEL = "arrivals, 7d vs prior 7d";
const KPI_COLUMNS = {
  3: "lg:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "lg:grid-cols-3 2xl:grid-cols-5",
  6: "lg:grid-cols-3 2xl:grid-cols-6",
};

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
      const { current, previous, delta } = caseTrend(records);
      let share = null;
      if (total > 0) share = bucket.aggregate ? 1 : records.length / total;
      out[bucket.key] = {
        share,
        shareTotal: total,
        delta: current || previous ? delta : null,
      };
    }
    return out;
  }, [buckets, recordsByKey, visible.length]);

  const selected =
    buckets.find((b) => b.key === selectedKey) || buckets[0] || null;
  const rows = selected ? recordsByKey[selected.key] || NO_RECORDS : NO_RECORDS;
  const selectedLabel = selected?.label || "Queries";

  return (
    <div className="pb-2">
      <DashboardHero
        userName={currentUser?.name}
        title={title}
        purpose={purpose}
        actions={actions}
      />

      <div
        role="group"
        aria-label="Queue summary"
        className={cn(
          "relative z-10 -mt-24 grid grid-cols-1 gap-4 sm:grid-cols-2",
          KPI_COLUMNS[buckets.length] || KPI_COLUMNS[4],
        )}
      >
        {buckets.map((bucket) => {
          const count = recordsByKey[bucket.key]?.length ?? 0;
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
              {...styleFor(bucket.key)}
            />
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">
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
          <VolumeChartCard label={selectedLabel} records={rows} />
        </div>

        <div className="min-w-0 space-y-6 xl:col-span-4">
          <StatusMixCard label={selectedLabel} records={rows} />
          <StageBreakdownCard label={selectedLabel} records={rows} />
          {sidePanel}
        </div>
      </div>
    </div>
  );
}
