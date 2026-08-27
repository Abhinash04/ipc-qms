import { cn } from "@/utils/cn";

export function StatTile({
  label,
  value,
  icon: Icon,
  cardBg = "#ffffff",
  cardBorder = "#e2e8f0",
  numColor = "#1e293b",
  iconBg,
  trendText,
  trendType,
  subtextMain,
  caption,
  subtextColor,
  className,
  onClick,
  selected = false,
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? selected : undefined}
      className={cn(
        "bento-card group relative select-none overflow-hidden rounded-[16px] p-3.5 sm:p-4 transition-all duration-200 flex flex-col justify-between h-full border shadow-[0_2px_8px_rgba(0,0,0,0.03)]",
        onClick &&
          "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] active:scale-[0.99]",
        selected &&
          "ring-2 ring-offset-1 ring-blue-500/80 shadow-md -translate-y-0.5",
        className,
      )}
      style={{
        background: cardBg,
        borderColor: cardBorder || "#e2e8f0",
      }}
    >
      <div className="relative z-10 flex h-full w-full flex-col justify-between space-y-2">
        {/* Top Header: Icon Badge */}
        <div className="flex items-center justify-between gap-2">
          {Icon ? (
            <div
              className={cn(
                "flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg text-white shadow-2xs transition-transform duration-200 group-hover:scale-105",
                iconBg || "bg-blue-600 text-white",
              )}
            >
              <Icon className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
            </div>
          ) : (
            <div />
          )}

          {trendText && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold",
                trendType === "down"
                  ? "bg-rose-50 text-rose-600 border-rose-200"
                  : "bg-emerald-50 text-emerald-600 border-emerald-200",
              )}
            >
              {trendText}
            </span>
          )}
        </div>

        {/* Middle KPI Value */}
        <div className="my-0.5">
          <div
            className="font-heading text-2xl sm:text-3xl font-extrabold leading-none tracking-tight"
            style={{ color: numColor || "#1e293b" }}
          >
            {value}
          </div>
        </div>

        {/* Bottom Label, Subtext & Caption */}
        <div>
          <h3 className="font-heading text-[13px] font-bold text-slate-800 m-0 leading-tight group-hover:text-slate-900 line-clamp-1">
            {label}
          </h3>

          {subtextMain && (
            <div
              className={cn(
                "text-[11.5px] font-semibold mt-0.5 flex items-center gap-1",
                subtextColor || "text-slate-600",
              )}
            >
              {subtextMain}
            </div>
          )}

          {caption && (
            <p className="text-[10.5px] font-medium text-slate-400 m-0 mt-0.5 line-clamp-1">
              {caption}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
