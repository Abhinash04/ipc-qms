import { Link } from 'react-router-dom';
import { ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

import { cn } from '@/utils/cn';

const nf = new Intl.NumberFormat();

/**
 * A headline figure with its period-over-period change.
 *
 * Deliberately not `common/StatTile`: that component applies its colour props
 * as inline CSS (`style={{ background: cardBg }}`) while its callers pass
 * Tailwind class names, so its tinted variants never actually render. Rather
 * than change a contract two other pages depend on, this tile owns its own
 * styling and takes classes throughout.
 *
 * `higherIsWorse` is the important prop. Colouring a trend by direction alone
 * would paint a rising failure rate green; the tile is told what the metric
 * means and colours the change accordingly.
 */

const DIRECTION_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

function trendTone(direction, higherIsWorse) {
  if (direction === 'flat') return 'text-slate-400';
  const good = higherIsWorse ? direction === 'down' : direction === 'up';
  return good ? 'text-emerald-600' : 'text-rose-600';
}

export function KpiTile({
  label,
  value,
  icon: Icon,
  to,
  delta,
  comparisonLabel = 'vs yesterday',
  tint = 'bg-slate-100 text-slate-600',
  surface = 'bg-white',
  border = 'border-slate-200/80',
  higherIsWorse = false,
}) {
  const TrendIcon = DIRECTION_ICON[delta?.direction] || Minus;
  const showComparison = delta && delta.direction !== 'flat';

  const body = (
    <>
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', tint)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block font-heading text-[27px] font-black leading-none tabular-nums text-slate-900">
          {nf.format(value ?? 0)}
        </span>
        <span className="mt-1 block truncate text-[13px] font-bold text-slate-500">{label}</span>
      </span>
    </>
  );

  const footer = delta && (
    <span className="mt-3 flex items-center gap-1.5 text-[11.5px] font-bold">
      {/* Direction is carried by the icon, the sign and the colour together,
          so nothing depends on hue alone. */}
      <TrendIcon
        className={cn('h-3.5 w-3.5', trendTone(delta.direction, higherIsWorse))}
        aria-hidden="true"
      />
      <span className={trendTone(delta.direction, higherIsWorse)}>{delta.text}</span>
      {showComparison && <span className="font-semibold text-slate-400">{comparisonLabel}</span>}
    </span>
  );

  const shell = cn(
    'group flex flex-col rounded-3xl border p-4 shadow-sm transition-colors',
    'motion-safe:transition-all motion-reduce:transition-none',
    surface,
    border,
  );

  if (!to) {
    return (
      <div className={shell}>
        <span className="flex items-start gap-3">{body}</span>
        {footer}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className={cn(
        shell,
        'hover:border-blue-300 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
      )}
    >
      <span className="flex items-start gap-3">
        {body}
        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-blue-500"
          aria-hidden="true"
        />
      </span>
      {footer}
    </Link>
  );
}
