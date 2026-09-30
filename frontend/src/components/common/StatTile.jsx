import { cn } from "@/utils/cn";
import { activateOnKey } from "@/utils/a11y";
import { DIRECTION_ICON, trendTone } from "@/components/common/trendTone";
import { RadialRing } from "@/components/charts/RadialRing";
import { TILE_TONES } from "@/components/common/tileTones";
import { CardDecor } from "@/components/common/CardDecor";

function TileTrend({ delta, higherIsWorse, neutral, comparisonLabel }) {
  if (!delta) {
    return (
      <span
        aria-hidden="true"
        title={`No ${comparisonLabel || "comparison"} to report yet`}
        className="select-none text-[11px] font-bold leading-none text-black/70"
      >
        —
      </span>
    );
  }

  const TrendIcon = DIRECTION_ICON[delta.direction] || DIRECTION_ICON.flat;
  const tone = neutral ? "text-ink-muted" : trendTone(delta.direction, higherIsWorse);

  return (
    <span
      title={comparisonLabel}
      className={cn("inline-flex items-center gap-1 text-[11.5px] font-semibold", tone)}
    >
      <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
      {delta.text}
    </span>
  );
}

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = "primary",
  delta,
  higherIsWorse,
  neutralTrend,
  comparisonLabel,
  share,
  shareTotal,
  caption,
  subtextMain,
  className,
  onClick,
  selected = false,
}) {
  const palette = TILE_TONES[tone] || TILE_TONES.primary;
  const pct = share == null ? null : Math.round(share * 100);
  const ringLabel =
    pct != null && shareTotal > 0
      ? `${pct}% of ${shareTotal} ${shareTotal === 1 ? "query" : "queries"} in view`
      : undefined;

  return (
    <div
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "bento-card group relative flex h-full select-none flex-col overflow-hidden rounded-2xl border-2 bg-surface p-4 shadow-card",
        "transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none",
        selected ? "border-primary" : "border-transparent dark:border-line/60",
        onClick &&
          "cursor-pointer outline-none hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-primary/50 motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <CardDecor colorClass={palette.ring} />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center gap-3.5">
          <RadialRing
            value={pct == null ? null : pct / 100}
            size={58}
            stroke={5}
            colorClass={palette.ring}
            label={ringLabel}
          >
            {Icon && (
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", palette.chip)}>
                <Icon className="h-4.5 w-4.5" strokeWidth={2.2} aria-hidden="true" />
              </span>
            )}
          </RadialRing>

          <div className="min-w-0 flex-1">
            <p
              data-slot="stat-label"
              className="m-0 line-clamp-2 text-[13px] font-semibold leading-snug text-black"
            >
              {label}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <div
                data-slot="stat-value"
                className="font-heading text-[26px] font-bold leading-none tracking-tight text-black tabular-nums"
              >
                {value}
              </div>
              <TileTrend
                delta={delta}
                higherIsWorse={higherIsWorse}
                neutral={neutralTrend}
                comparisonLabel={comparisonLabel}
              />
            </div>
          </div>
        </div>

        {subtextMain && (
          <div className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-black">
            {subtextMain}
          </div>
        )}
        {caption && (
          <p className="m-0 mt-3 line-clamp-2 text-[11.5px] font-medium leading-snug text-black">{caption}</p>
        )}
      </div>

      {selected && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 z-20 h-1 bg-primary" />
      )}
    </div>
  );
}
