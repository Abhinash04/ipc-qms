import { ApexChart } from "@/components/charts/ApexChart";
import { SERIES_CSS } from "@/components/charts/chartTheme";

function listSummary(points) {
  return points.map((p) => `${p.label}: ${p.value}`).join(", ");
}

export function AreaTrendChart({ series, height = 260, label }) {
  const categories = series[0]?.points.map((p) => p.label) || [];
  const apexSeries = series.map((s) => ({ name: s.name, data: s.points.map((p) => p.value) }));

  return (
    <ApexChart
      type="area"
      height={height}
      label={label}
      summary={series.map((s) => `${s.name} — ${listSummary(s.points)}`).join("; ")}
      series={apexSeries}
      options={(theme) => ({
        colors: theme.series,
        stroke: { curve: "smooth", width: 3 },
        fill: {
          type: "gradient",
          gradient: { shadeIntensity: 0, opacityFrom: 0.4, opacityTo: 0.02, stops: [0, 90, 100] },
        },
        markers: { size: 0, hover: { size: 5 } },
        xaxis: {
          categories,
          axisBorder: { show: false },
          axisTicks: { show: false },
          labels: { rotate: 0, hideOverlappingLabels: true, style: { fontSize: "11px" } },
          tooltip: { enabled: false },
        },
        yaxis: {
          min: 0,
          forceNiceScale: true,
          labels: { formatter: (v) => String(Math.round(v)), style: { fontSize: "11px" } },
        },
        legend: { show: series.length > 1, position: "top", horizontalAlign: "right" },
      })}
    />
  );
}

export function BarVolumeChart({ points, name = "Cases", height = 240, label, horizontal = false }) {
  // Counts are whole numbers: one tick per unit (capped at 5) so the value
  // axis never shows 0.5, 1.5 ….
  const max = Math.max(1, ...points.map((p) => p.value));
  const valueTicks = Math.min(max, 5);
  const wholeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && Number.isInteger(n) ? String(n) : "";
  };

  return (
    <ApexChart
      type="bar"
      height={height}
      label={label}
      summary={listSummary(points)}
      series={[{ name, data: points.map((p) => p.value) }]}
      options={(theme) => ({
        colors: [theme.primary],
        plotOptions: {
          bar: {
            horizontal,
            borderRadius: 5,
            borderRadiusApplication: "end",
            columnWidth: "42%",
            barHeight: "55%",
            distributed: false,
          },
        },
        xaxis: {
          categories: points.map((p) => p.label),
          axisBorder: { show: false },
          axisTicks: { show: false },
          // In a horizontal chart the x axis carries the values.
          ...(horizontal ? { tickAmount: valueTicks, max } : {}),
          labels: {
            ...(horizontal ? { formatter: wholeNumber } : {}),
            style: { fontSize: "11px" },
          },
        },
        yaxis: {
          min: 0,
          ...(horizontal ? {} : { tickAmount: valueTicks, max }),
          labels: {
            formatter: (v) => (typeof v === "number" ? wholeNumber(v) : v),
            style: { fontSize: "11px" },
          },
        },
      })}
    />
  );
}

export function DonutChart({ slices, height = 240, label, totalLabel = "Total", showLegend = true }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <div>
      <ApexChart
        type="donut"
        height={height}
        label={label}
        summary={`${totalLabel} ${total}. ${listSummary(slices)}`}
        series={total === 0 ? slices.map(() => 0) : slices.map((s) => s.value)}
        options={(theme) => ({
          labels: slices.map((s) => s.label),
          colors: theme.series,
          stroke: { width: 3, colors: [theme.surface] },
          legend: { show: false },
          plotOptions: {
            pie: {
              donut: {
                size: "72%",
                labels: {
                  show: true,
                  name: { fontSize: "12px", color: theme.muted, offsetY: 18 },
                  value: { fontSize: "24px", fontWeight: 700, color: theme.ink, offsetY: -14 },
                  total: {
                    show: true,
                    showAlways: true,
                    label: totalLabel,
                    color: theme.muted,
                    fontSize: "12px",
                    formatter: () => String(total),
                  },
                },
              },
            },
          },
          noData: { text: "No data yet", style: { color: theme.muted } },
        })}
      />
      {showLegend && (
        <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12.5px]">
          {slices.map((slice, index) => (
            <li key={slice.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SERIES_CSS[index % SERIES_CSS.length] }}
              />
              <span className="text-ink-muted">{slice.label}</span>
              <span className="font-semibold tabular-nums text-ink">{slice.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RadialBarsChart({ rings, height = 260, label }) {
  const percents = rings.map((r) => (r.max ? Math.round((r.value / r.max) * 100) : 0));

  return (
    <ApexChart
      type="radialBar"
      height={height}
      label={label}
      summary={rings.map((r) => `${r.label}: ${r.value} of ${r.max}`).join(", ")}
      series={percents}
      options={(theme) => ({
        labels: rings.map((r) => r.label),
        colors: theme.series,
        plotOptions: {
          radialBar: {
            hollow: { size: "32%" },
            track: { background: theme.line, margin: 6 },
            dataLabels: {
              name: { fontSize: "12px", color: theme.muted },
              value: { fontSize: "18px", color: theme.ink, formatter: (v) => `${Math.round(v)}%` },
            },
          },
        },
        stroke: { lineCap: "round" },
        legend: { show: true, position: "bottom" },
      })}
    />
  );
}
