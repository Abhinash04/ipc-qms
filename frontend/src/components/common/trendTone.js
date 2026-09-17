import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Shared by the dashboard KPI tiles and the admin console tiles.
 *
 * `higherIsWorse` is the important argument. Colouring a trend by direction
 * alone would paint a rising failure rate green; the caller says what the
 * metric means and the change is coloured accordingly. Omitting it means "up
 * is good", which is the admin console's long-standing default.
 *
 * A metric where neither direction is good or bad — a running total — should
 * not be coloured at all; callers render those neutral rather than passing a
 * flag here.
 */

export const DIRECTION_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export function trendTone(direction, higherIsWorse) {
  if (direction === 'flat') return 'text-slate-400';
  const good = higherIsWorse ? direction === 'down' : direction === 'up';
  return good ? 'text-emerald-600' : 'text-rose-600';
}
