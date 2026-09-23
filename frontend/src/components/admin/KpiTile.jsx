import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/utils/cn';
import { DIRECTION_ICON, trendTone } from '@/components/common/trendTone';

const nf = new Intl.NumberFormat();

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
  const TrendIcon = DIRECTION_ICON[delta?.direction] || DIRECTION_ICON.flat;
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
