import { cn } from '@/lib/utils';

/**
 * Dependency-free horizontal bar list for small distributions. Each item is a
 * label + a proportional CSS bar + its value. Theme-aware via Tailwind tokens;
 * no chart library.
 *
 * @param {{ key: string, count: number }[]} data
 * @param {(v:number)=>string} [valueFormatter]
 */
export function BarList({ data = [], valueFormatter = (v) => v, className }) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground py-4">No data.</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className={cn('space-y-2', className)}>
      {data.map((d) => (
        <div key={d.key} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-sm capitalize truncate" title={String(d.key).replace(/_/g, ' ')}>
            {String(d.key).replace(/_/g, ' ')}
          </div>
          <div className="flex-1 h-6 rounded bg-muted overflow-hidden">
            <div
              className="h-full rounded bg-primary/80"
              style={{ width: `${Math.max((d.count / max) * 100, 2)}%` }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
            {valueFormatter(d.count)}
          </div>
        </div>
      ))}
    </div>
  );
}
