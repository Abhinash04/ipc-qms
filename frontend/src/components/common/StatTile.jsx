import { cn } from '@/utils/cn';

export function StatTile({
  label,
  value,
  icon: Icon,
  cardBg,
  cardBorder,
  iconBg,
  iconColor,
  accentBar,
  numColor,
  up,
  delta,
  total = 0,
  className
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[13px] border p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all duration-150 cursor-default hover:shadow-[0_6px_20px_rgba(0,0,0,0.09)] hover:-translate-y-0.5",
        className
      )}
      style={{
        background: cardBg,
        borderColor: cardBorder,
      }}
    >
      <div className="flex items-center justify-between mb-3.5">
        <span className="text-[12px] font-medium opacity-80" style={{ color: iconColor }}>
          {label}
        </span>
        {Icon && (
          <div
            className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[9px] border"
            style={{ backgroundColor: iconBg, color: iconColor, borderColor: cardBorder }}
          >
            <Icon className="h-4.5 w-4.5" strokeWidth={1.8} aria-hidden="true" />
          </div>
        )}
      </div>
      
      <div
        className="font-heading text-[36px] font-bold leading-none tracking-[-0.03em]"
        style={{ color: numColor }}
      >
        {value}
      </div>
      
      {/* No trend for a period with no activity — an empty row beats inventing one. */}
      {delta ? (
        <div
          className="mt-2 flex items-center gap-0.75 text-[11.5px] font-medium"
          style={{ color: up === true ? '#16a34a' : up === false ? '#dc2626' : '#92400e' }}
        >
          {up === true && '↑ '}
          {up === false && '↓ '}
          {delta}
        </div>
      ) : (
        <div className="mt-2 h-4.25" aria-hidden="true" />
      )}

      {/* Share of `total`, so the bar means something. Without a total there is
          nothing to be a share of, and it stays empty rather than implying one. */}
      <div className="mt-3.5 h-0.75 w-full overflow-hidden rounded-full" style={{ backgroundColor: cardBorder }}>
        <div
          className="h-full rounded-full"
          style={{
            width: total > 0 ? `${Math.min(100, (value / total) * 100)}%` : '0%',
            backgroundColor: accentBar,
          }}
        />
      </div>
    </div>
  );
}
