import { AreaTrendChart, BarVolumeChart, DonutChart } from '@/components/charts/Charts';
import { SERIES_CSS } from '@/components/charts/chartTheme';

const nf = new Intl.NumberFormat();

function EmptyFigure({ title, emptyText }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-semibold text-ink-soft">{title}</figcaption>
      <p className="rounded-xl border border-dashed border-line py-10 text-center text-xs text-ink-muted">
        {emptyText}
      </p>
    </figure>
  );
}


export function StatusDonut({ data, title, emptyText = 'No data yet' }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!total) return <EmptyFigure title={title} emptyText={emptyText} />;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[13px] font-semibold text-ink-soft">{title}</figcaption>
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-48 shrink-0">
          <DonutChart slices={data} height={200} label={title} totalLabel="Total" showLegend={false} />
        </div>
        <ul className="m-0 min-w-40 flex-1 space-y-2 p-0">
          {data.map((slice, index) => (
            <li key={slice.label} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: SERIES_CSS[index % SERIES_CSS.length] }}
              />
              <span className="flex-1 truncate font-medium text-ink-soft">{slice.label}</span>
              <span className="font-semibold tabular-nums text-ink">{nf.format(slice.value)}</span>
              <span className="w-10 text-end tabular-nums text-ink-muted">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function VolumeBars({ data, title, emptyText = 'No activity recorded yet' }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!data.length || !max) return <EmptyFigure title={title} emptyText={emptyText} />;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[13px] font-semibold text-ink-soft">{title}</figcaption>
      <BarVolumeChart points={data} height={200} label={title} />
    </figure>
  );
}

export function TrendLine({ data, title, emptyText = 'No activity recorded yet' }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!data.length || !max) return <EmptyFigure title={title} emptyText={emptyText} />;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[13px] font-semibold text-ink-soft">{title}</figcaption>
      <AreaTrendChart series={[{ name: 'Cases', points: data }]} height={190} label={title} />
    </figure>
  );
}

export function ProcessingFunnel({ stages, title, emptyText = 'No processing recorded yet' }) {
  const top = stages.length ? stages[0].value : 0;
  if (!top) return <EmptyFigure title={title} emptyText={emptyText} />;

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-semibold text-ink-soft">{title}</figcaption>
      <ol className="m-0 list-none space-y-3 p-0">
        {stages.map((stage, index) => {
          const previous = index === 0 ? stage.value : stages[index - 1].value;
          const dropped = previous - stage.value;

          return (
            <li key={stage.label}>
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-medium text-ink-soft">{stage.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="font-semibold tabular-nums text-ink">{nf.format(stage.value)}</span>
                  {index > 0 && dropped > 0 && (
                    <span className="text-[11px] font-semibold tabular-nums text-danger">
                      −{nf.format(dropped)}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700"
                  style={{
                    width: `${Math.max((stage.value / top) * 100, stage.value ? 2 : 0)}%`,
                    opacity: 1 - index * 0.1,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
