import { CHART_SERIES, CHART_SINGLE, CHART_TRACK, CHART_GRID } from '@/constants/chartPalette';

/**
 * Small, dependency-free charts.
 *
 * Hand-rolled SVG/CSS rather than a charting library: three simple forms did
 * not justify a new runtime dependency, and the shapes here are a few lines of
 * geometry each.
 *
 * Every series is direct-labelled and legended — identity is never carried by
 * colour alone, which the validated palette explicitly requires.
 */

const nf = new Intl.NumberFormat();

/**
 * Composition of a whole. Direct labels and a 2px gap between arcs are not
 * decoration — they are the secondary encoding that makes the purple/green
 * pair legible to a deuteranopic reader.
 */
export function StatusDonut({ data, title, emptyText = 'No data yet' }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (!total) {
    return (
      <figure className="m-0">
        <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
          {emptyText}
        </p>
      </figure>
    );
  }

  const size = 168;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // A 2px visual gap between neighbouring arcs, expressed in path units.
  const gap = 2;

  // Cumulative start angle per slice, computed up front rather than mutated
  // during the render pass.
  const starts = data.reduce((acc) => {
    const previous = acc.length ? acc[acc.length - 1] : 0;
    const previousFraction = acc.length ? data[acc.length - 1].value / total : 0;
    return [...acc, previous + previousFraction * circumference];
  }, []);

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
      <div className="flex flex-wrap items-center gap-5">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${nf.format(total)} total`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={CHART_TRACK} strokeWidth={stroke} />
          {data.map((slice, index) => {
            const fraction = slice.value / total;
            const length = Math.max(fraction * circumference - gap, 0);
            const dash = `${length} ${circumference - length}`;
            const rotation = (starts[index] / circumference) * 360 - 90;

            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={CHART_SERIES[index % CHART_SERIES.length]}
                strokeWidth={stroke}
                strokeDasharray={dash}
                transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
              >
                <title>{`${slice.label}: ${nf.format(slice.value)}`}</title>
              </circle>
            );
          })}
          <text
            x={size / 2}
            y={size / 2 - 4}
            textAnchor="middle"
            className="fill-slate-900 text-[26px] font-black"
          >
            {nf.format(total)}
          </text>
          <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="fill-slate-400 text-[11px] font-bold">
            total
          </text>
        </svg>

        {/* The legend is mandatory at two or more series, and each row carries
            its own number so the reading never depends on matching a hue. */}
        <ul className="m-0 min-w-40 flex-1 space-y-1.5 p-0">
          {data.map((slice, index) => (
            <li key={slice.label} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: CHART_SERIES[index % CHART_SERIES.length] }}
              />
              <span className="flex-1 truncate font-semibold text-slate-700">{slice.label}</span>
              <span className="font-black tabular-nums text-slate-900">{nf.format(slice.value)}</span>
              <span className="w-10 text-right tabular-nums text-slate-400">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

/** Magnitude over time. One measure, one hue, so no legend is needed. */
export function VolumeBars({ data, title, emptyText = 'No activity recorded yet' }) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (!data.length || !max) {
    return (
      <figure className="m-0">
        <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
          {emptyText}
        </p>
      </figure>
    );
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
      <div className="flex h-36 items-end gap-1.5">
        {data.map((bar) => (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${bar.label}: ${nf.format(bar.value)}`}>
            <span className="text-[10.5px] font-black tabular-nums text-slate-500">{bar.value || ''}</span>
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max((bar.value / max) * 100, bar.value ? 4 : 1)}%`,
                backgroundColor: bar.value ? CHART_SINGLE : CHART_TRACK,
              }}
            />
            <span className="truncate text-[10.5px] font-semibold text-slate-400">{bar.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/**
 * Change over time. One measure, one hue, so no legend — the axis and the
 * point markers carry the reading.
 *
 * Takes the same `[{label, value}]` shape as VolumeBars, so either can render
 * the same series.
 */
export function TrendLine({ data, title, emptyText = 'No activity recorded yet' }) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (!data.length || !max) {
    return (
      <figure className="m-0">
        <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
          {emptyText}
        </p>
      </figure>
    );
  }

  // A viewBox with preserveAspectRatio="none" would distort the stroke, so the
  // geometry is computed in real units and the svg scales by width only.
  const width = 320;
  const height = 132;
  const padding = { top: 10, right: 8, bottom: 4, left: 30 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Round the axis up so the top gridline is a readable number, never the
  // raw maximum.
  const ceiling = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const ticks = [ceiling, Math.round(ceiling / 2), 0];

  const x = (index) =>
    padding.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const y = (value) => padding.top + plotHeight - (value / ceiling) * plotHeight;

  const points = data.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full"
        role="img"
        aria-label={`${title}: ${data.map((d) => `${d.label} ${nf.format(d.value)}`).join(', ')}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={CHART_GRID}
              strokeWidth="1"
            />
            <text
              x={padding.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-slate-400 text-[9px] font-semibold"
            >
              {nf.format(tick)}
            </text>
          </g>
        ))}

        <polyline
          points={points}
          fill="none"
          stroke={CHART_SINGLE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {data.map((point, index) => (
          <circle key={point.label} cx={x(index)} cy={y(point.value)} r="3.5" fill={CHART_SINGLE}>
            <title>{`${point.label}: ${nf.format(point.value)}`}</title>
          </circle>
        ))}
      </svg>

      {/* Labels sit outside the svg so they inherit the page's font stack and
          wrap predictably at narrow widths. */}
      <div className="mt-1 flex pl-[9%]">
        {data.map((point) => (
          <span
            key={point.label}
            className="flex-1 truncate text-center text-[10px] font-semibold text-slate-400"
          >
            {point.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Where work accumulates. Stages of one measure, so a single hue with the
 * count and drop-off written on each row — the point is the gap between
 * stages, not the colour.
 */
export function ProcessingFunnel({ stages, title, emptyText = 'No processing recorded yet' }) {
  const top = stages.length ? stages[0].value : 0;

  if (!top) {
    return (
      <figure className="m-0">
        <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
        <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
          {emptyText}
        </p>
      </figure>
    );
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[13px] font-bold text-slate-700">{title}</figcaption>
      <ol className="m-0 list-none space-y-1.5 p-0">
        {stages.map((stage, index) => {
          const previous = index === 0 ? stage.value : stages[index - 1].value;
          const dropped = previous - stage.value;

          return (
            <li key={stage.label}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-semibold text-slate-700">{stage.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="font-black tabular-nums text-slate-900">{nf.format(stage.value)}</span>
                  {index > 0 && dropped > 0 && (
                    <span className="text-[11px] font-bold tabular-nums text-slate-400">−{nf.format(dropped)}</span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded" style={{ backgroundColor: CHART_TRACK }}>
                <div
                  className="h-full rounded"
                  style={{ width: `${Math.max((stage.value / top) * 100, stage.value ? 2 : 0)}%`, backgroundColor: CHART_SINGLE }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
