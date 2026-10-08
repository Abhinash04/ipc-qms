import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

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
