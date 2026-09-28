import { useMemo, useState } from "react";
import { AreaTrendChart, BarVolumeChart, DonutChart } from "@/components/charts/Charts";
import { statusDistribution, volumeSeries } from "@/components/admin/adminStats";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";

const RANGES = [
  { key: "week", labelKey: "dashboard.week" },
  { key: "month", labelKey: "dashboard.month" },
  { key: "quarter", labelKey: "dashboard.quarter" },
];

function ChartCard({ id, title, description, actions, children }) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-2xl border border-transparent bg-surface shadow-card dark:border-line/60"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id={id} className="font-heading text-[17px] font-semibold leading-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[12.5px] text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-3 pt-2 pb-3">{children}</div>
    </section>
  );
}

export function VolumeChartCard({ visible, selected, selectedRecords }) {
  const t = useT();
  const [range, setRange] = useState("week");

  const series = useMemo(() => {
    const all = { name: "All in view", points: volumeSeries(visible, range) };
    if (!selected || selected.aggregate) return [all];
    return [all, { name: selected.label, points: volumeSeries(selectedRecords, range) }];
  }, [visible, selected, selectedRecords, range]);

  const total = series[0].points.reduce((sum, p) => sum + p.value, 0);

  return (
    <ChartCard
      id="dashboard-volume-title"
      title={t("dashboard.volume")}
      description={`${total} ${total === 1 ? "query" : "queries"} received in this period`}
      actions={
        <div role="group" aria-label="Chart range" className="flex rounded-lg bg-surface-muted p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                range === r.key ? "bg-surface text-primary shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>
      }
    >
      <AreaTrendChart series={series} height={270} label="Queries received over time" />
    </ChartCard>
  );
}

export function StatusMixCard({ visible }) {
  const t = useT();
  const slices = useMemo(() => statusDistribution(visible), [visible]);

  return (
    <ChartCard
      id="dashboard-status-title"
      title={t("dashboard.statusMix")}
      description="Business status of every query in view"
    >
      <DonutChart slices={slices} height={260} label="Queries by business status" totalLabel="Queries" />
    </ChartCard>
  );
}

export function BucketBarsCard({ buckets, recordsByKey }) {
  const points = buckets
    .filter((b) => !b.aggregate)
    .map((b) => ({ label: b.label, value: recordsByKey[b.key]?.length ?? 0 }));

  if (points.length === 0) return null;

  return (
    <ChartCard id="dashboard-buckets-title" title="Queue breakdown" description="Queries in each of your lists">
      <BarVolumeChart points={points} horizontal height={Math.max(180, points.length * 44)} label="Queries per list" />
    </ChartCard>
  );
}
