import { cn } from "@/utils/cn";
import { activateOnKey } from "@/utils/a11y";
import { DIRECTION_ICON, trendTone } from "@/components/common/trendTone";

/**
 * Callers pass colours either as raw CSS (the dashboard uses gradients and
 * token `var(--…)` references) or as Tailwind classes (the admin consoles do).
 * Applying a class name through `style` silently does nothing, which is why
 * those tiles used to render with no colour at all — so each value is routed to
 * whichever channel can accept it.
 */
const CSS_VALUE =
  /^(#|rgb|hsl|linear-gradient|radial-gradient|repeating-linear-gradient|repeating-radial-gradient|var\()/i;
const isCssValue = (value) =>
  typeof value === "string" && CSS_VALUE.test(value.trim());

/**
 * All the colour routing in one place, so the component body stays flat enough
 * to read. Pure — no state, no effects, so deliberately not a hook.
 */
function resolveToneVisuals({ cardBg, cardBorder, numColor, accent, glow }) {
  const rootStyle = {};
  if (isCssValue(cardBg)) rootStyle.background = cardBg;
  if (isCssValue(cardBorder)) rootStyle.borderColor = cardBorder;

  // Consumed by the sparkline, share bar and selected ring. The fallbacks keep
  // the three non-dashboard callers, which pass no tone, rendering as before.
  const tone = accent || (isCssValue(numColor) ? numColor : null);
  if (tone) {
    rootStyle["--tone-accent"] = tone;
    rootStyle["--tone-ring"] = tone;
  }
  // The card's own hue, for the drop shadow it casts on the page.
  if (glow) rootStyle["--tone-glow"] = glow;

  return {
    rootStyle,
    surfaceClass: !isCssValue(cardBg) && cardBg,
    borderClass: !isCssValue(cardBorder) && cardBorder,
    valueClass: !isCssValue(numColor) && numColor,
    valueStyle: isCssValue(numColor) ? { color: numColor } : undefined,
  };
}


/**
 * Per-variant chrome. A table rather than a chain of ternaries in the render
 * body — the branching is what the complexity rule counts, and none of this
 * depends on anything but the variant.
 */
const CHROME = {
  tinted: {
    shell:
      "rounded-[18px] px-4 pt-4 pb-5 shadow-[0_14px_30px_-16px_var(--tone-glow,rgba(15,23,42,0.35))]",
    hover:
      "hover:shadow-[0_20px_40px_-16px_var(--tone-glow,rgba(15,23,42,0.45))]",
    ring: "ring-2 ring-inset ring-[color:var(--tone-ring,#3b82f6)]",
    // slate-500 measures 3.3-3.9:1 on the darker gradient stop; slate-600
    // clears 5.3:1 on every tone.
    label: "text-slate-600",
    caption: "text-slate-600",
    figure: "text-[40px] sm:text-[44px]",
    dash: "text-slate-400",
    chip: "border border-white/90 bg-white/85",
    track: "bg-tone-track",
  },
  plain: {
    shell: "rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)]",
    hover: "hover:shadow-[0_10px_26px_rgba(15,23,42,0.09)]",
    ring: "ring-2 ring-inset ring-[color:var(--tone-ring,#3b82f6)]",
    label: "text-slate-500",
    caption: "text-slate-500/90",
    figure: "text-[38px] sm:text-[42px]",
    dash: "text-slate-400/70",
    chip: "border border-white/80 bg-white/75",
    track: "bg-tone-track",
  },
};

const chromeFor = (variant) => CHROME[variant === "tinted" ? "tinted" : "plain"];

/**
 * Period-over-period change.
 *
 * On a saturated card the semantic green/red cannot carry on the surface
 * itself — it would neither pass contrast nor read as a hue. The chip inverts
 * instead: a near-white pill holding the coloured text, so good-versus-bad
 * survives at full strength.
 *
 * `neutral` covers metrics where neither direction is good or bad — a running
 * total. With no reading at all the slot still renders, as an em dash: an
 * absent chip made the card look like a different design rather than the same
 * design with nothing to report.
 */
function TileTrend({ delta, higherIsWorse, neutral, comparisonLabel, chrome }) {
  if (!delta) {
    return (
      <span
        aria-hidden="true"
        title={`No ${comparisonLabel} to report yet`}
        className={cn(
          "ml-auto shrink-0 select-none text-[11px] font-bold leading-none",
          chrome.dash,
        )}
      >
        —
      </span>
    );
  }

  const TrendIcon = DIRECTION_ICON[delta.direction] || DIRECTION_ICON.flat;
  const tone = neutral
    ? "text-slate-500"
    : trendTone(delta.direction, higherIsWorse);

  return (
    <span
      title={comparisonLabel}
      className={cn(
        "ml-auto shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold shadow-2xs",
        chrome.chip,
        tone,
      )}
    >
      <TrendIcon className="h-3 w-3" aria-hidden="true" />
      {delta.text}
    </span>
  );
}

/**
 * Seven-day arrival trend, drawn as an area across the foot of the card.
 *
 * `preserveAspectRatio="none"` lets it fill any card width with no geometry
 * measurement at all — jsdom has no layout engine, and measuring would make the
 * tile untestable. `vectorEffect` cancels the stroke distortion the resulting
 * non-uniform scale would otherwise cause.
 *
 * `aria-hidden` with no `<title>` child: an SVG title contributes to
 * textContent, which the dashboard tests read as the tile's figure.
 *
 * With no arrivals it still draws its baseline. A baseline is chrome, not a
 * measurement — hiding it made an empty dashboard look like an older build.
 */
function TileSparkline({ series, bold }) {
  const points =
    series && series.length > 1
      ? (() => {
          const max = Math.max(...series.map((d) => d.value), 1);
          const step = 100 / (series.length - 1);
          return series.map(
            (d, i) =>
              `${(i * step).toFixed(2)},${(30 - (d.value / max) * 23).toFixed(2)}`,
          );
        })()
      : null;

  const last = points ? points[points.length - 1].split(",") : null;
  const stroke = "var(--tone-accent, #94a3b8)";

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-16 w-full"
    >
      {points && (
        <polygon
          points={`0,32 ${points.join(" ")} 100,32`}
          fill={stroke}
          fillOpacity={bold ? "0.22" : "0.16"}
        />
      )}
      {points && (
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={stroke}
          strokeOpacity={bold ? "0.9" : "0.55"}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {last && bold && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r="2.6"
          fill={stroke}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <line
        x1="0"
        y1="31"
        x2="100"
        y2="31"
        stroke={stroke}
        strokeOpacity={bold ? "0.35" : "0.28"}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * This bucket's share of everything in view, as a full-bleed bar on the card's
 * bottom edge.
 *
 * The percentage is exposed only through `role="img"` + `aria-label`: a visible
 * "NN%" text node would land in the tile's textContent, which the dashboard
 * tests read as the tile's figure.
 *
 * The empty groove renders even at zero — it is a container, not a claim.
 */
function TileShareBar({ share, shareTotal, chrome }) {
  const pct = share == null ? 0 : Math.round(share * 100);
  const known = share != null && shareTotal > 0;

  return (
    <div
      role={known ? "img" : undefined}
      aria-hidden={known ? undefined : "true"}
      aria-label={
        known
          ? `${pct}% of ${shareTotal} ${shareTotal === 1 ? "query" : "queries"} in view`
          : undefined
      }
      title={known ? `${pct}% of ${shareTotal}` : undefined}
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 h-1",
        chrome.track,
      )}
    >
      <div
        className="h-full rounded-r-full"
        style={{ width: `${pct}%`, background: "var(--tone-accent, #64748b)" }}
      />
    </div>
  );
}

export function StatTile({
  label,
  value,
  icon: Icon,
  variant,
  cardBg = "#ffffff",
  cardBorder = "#e2e8f0",
  numColor = "#1e293b",
  accent,
  glow,
  iconBg,
  delta,
  higherIsWorse,
  neutralTrend,
  comparisonLabel,
  share,
  shareTotal,
  series,
  subtextMain,
  caption,
  subtextColor,
  className,
  onClick,
  selected = false,
}) {
  const chrome = chromeFor(variant);
  // The tinted card can carry a fuller chart than a plain white one.
  const boldChart = variant === "tinted";
  const { rootStyle, surfaceClass, borderClass, valueClass, valueStyle } =
    resolveToneVisuals({ cardBg, cardBorder, numColor, accent, glow });

  return (
    <div
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "bento-card group relative select-none overflow-hidden flex flex-col h-full border",
        "transition-[background-color,border-color,box-shadow,transform] duration-200 motion-reduce:transition-none",
        chrome.shell,
        surfaceClass,
        borderClass,
        // MotionConfig only reaches framer-motion, so these transforms need
        // their own reduced-motion guard.
        onClick &&
          "cursor-pointer motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99]",
        onClick && chrome.hover,
        // ring-inset, not ring-offset: .bento-card is overflow:hidden and clips
        // an offset ring entirely.
        selected && chrome.ring,
        className,
      )}
      style={rootStyle}
    >
      <TileSparkline series={series} bold={boldChart} />

      <div className="relative z-10 flex h-full w-full flex-col gap-2.5">
        {/* Icon and label lead, so a row of tiles reads label-then-figure
            rather than a line of numbers you have to decode afterwards. */}
        <div className="flex items-center gap-2">
          {Icon && (
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 motion-safe:group-hover:scale-105",
                iconBg || "bg-blue-600 text-white",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2.4} />
            </div>
          )}

          {/* A clickable KPI filter, not a document section — a heading here
              breaks heading order (h1 → h3) on every dashboard, and would also
              displace the query list's h2 that dashboard.test.jsx locates the
              list panel by. */}
          <p
            data-slot="stat-label"
            className={cn(
              "font-heading text-[10.5px] font-bold uppercase tracking-[0.075em] m-0 leading-tight line-clamp-2",
              chrome.label,
            )}
          >
            {label}
          </p>

          <TileTrend
            delta={delta}
            higherIsWorse={higherIsWorse}
            neutral={neutralTrend}
            comparisonLabel={comparisonLabel}
            chrome={chrome}
          />
        </div>

        {/* mt-auto pins the figure to the bottom so tiles of differing label
            lengths still align their numbers across the row. */}
        <div className="mt-auto">
          {/* Contract: this element holds the number and nothing else.
              dashboard.test.jsx:77 reads it as Number(textContent.trim()), so a
              separator, a suffix or a nested badge here breaks the suite. */}
          <div
            data-slot="stat-value"
            className={cn(
              "font-heading font-black leading-[0.88] tracking-[-0.04em] tabular-nums",
              chrome.figure,
              valueClass,
            )}
            style={valueStyle}
          >
            {value}
          </div>

          {subtextMain && (
            <div
              className={cn(
                "text-[11.5px] font-semibold mt-1.5 flex items-center gap-1",
                subtextColor || "text-slate-600",
              )}
            >
              {subtextMain}
            </div>
          )}

          {caption && (
            <p
              className={cn(
                "text-[10.5px] font-medium m-0 mt-1.5 leading-snug line-clamp-2",
                chrome.caption,
              )}
            >
              {caption}
            </p>
          )}
        </div>
      </div>

      <TileShareBar share={share} shareTotal={shareTotal} chrome={chrome} />
    </div>
  );
}
