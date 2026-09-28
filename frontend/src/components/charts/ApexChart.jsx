import { lazy, Suspense, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { baseOptions, mergeOptions, useChartTheme } from "@/components/charts/chartTheme";

const LazyChart = lazy(() => import("@/components/charts/apexRuntime"));

export function ApexChart({ type, series, options, height = 260, label, summary, className }) {
  const theme = useChartTheme();

  const merged = useMemo(() => {
    const extra = typeof options === "function" ? options(theme) : options;
    return mergeOptions(baseOptions(theme), extra);
  }, [theme, options]);

  return (
    <div className={className} style={{ minHeight: height }}>
      <div role="img" aria-label={summary ? `${label}. ${summary}` : label}>
        <Suspense fallback={<Skeleton className="w-full" style={{ height }} />}>
          <div aria-hidden="true">
            <LazyChart
              key={`${theme.mode}-${theme.preset}`}
              type={type}
              series={series}
              options={merged}
              height={height}
              width="100%"
            />
          </div>
        </Suspense>
      </div>
    </div>
  );
}
