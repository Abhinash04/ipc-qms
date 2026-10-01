import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '@/utils/cn';
import { DIRECTION_ICON, trendTone } from '@/components/common/trendTone';
import { CardDecor } from '@/components/common/CardDecor';

const nf = new Intl.NumberFormat();

export function KpiTile({
  label,
  value,
  icon: Icon,
  to,
  delta,
  comparisonLabel = 'vs yesterday',
  tint = 'bg-primary-50 text-primary',
  accent = 'text-primary',
  higherIsWorse = false,
}) {
  const TrendIcon = DIRECTION_ICON[delta?.direction] || DIRECTION_ICON.flat;
  const showComparison = delta && delta.direction !== 'flat';

  const body = (
    <>
      <CardDecor colorClass={accent} />
      <span className="relative z-10 flex items-start justify-between gap-3">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', tint)}>
          <Icon className="h-5.5 w-5.5" aria-hidden="true" />
        </span>
        {to && (
          <ArrowUpRight
            className="h-4.5 w-4.5 shrink-0 text-ink-muted transition-colors group-hover:text-primary rtl:-scale-x-100"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="relative z-10 mt-4 block truncate text-[13px] font-medium text-ink-muted">{label}</span>
      <span className="relative z-10 mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-[28px] font-bold leading-none tabular-nums text-ink">
          {nf.format(value ?? 0)}
        </span>
        {delta && (
          <span className="flex items-center gap-1 text-[11.5px] font-semibold">
            <TrendIcon
              className={cn('h-3.5 w-3.5', trendTone(delta.direction, higherIsWorse))}
              aria-hidden="true"
            />
            <span className={trendTone(delta.direction, higherIsWorse)}>{delta.text}</span>
            {showComparison && <span className="font-medium text-ink-muted">{comparisonLabel}</span>}
          </span>
        )}
      </span>
    </>
  );

  const shell =
    'group relative flex flex-col overflow-hidden rounded-2xl border border-transparent bg-surface p-5 shadow-card transition-[box-shadow,transform]';

  if (!to) return <div className={shell}>{body}</div>;

  return (
    <Link
      to={to}
      className={cn(
        shell,
        'hover:shadow-card-hover motion-safe:hover:-translate-y-0.5',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      {body}
    </Link>
  );
}
