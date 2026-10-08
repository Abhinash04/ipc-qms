import { useId } from "react";
import { Bot, ChevronRight, Inbox, Users } from "lucide-react";

import { MAIL_BUCKETS, MAIL_BUCKET_META } from "@/constants/mailCategories";
import { cn } from "@/utils/cn";

const STYLE = {
  [MAIL_BUCKETS.ALL]: {
    icon: Inbox,
    surface: "border-primary-100 from-primary-50/70",
    active: "border-primary ring-1 ring-primary",
    tile: "bg-primary-50 text-primary ring-primary-100",
    count: "bg-primary-50 text-primary-700",
    arrow: "border-primary-200 text-primary",
    arrowActive: "border-transparent bg-primary text-white",
  },
  [MAIL_BUCKETS.AUTO_REPLY]: {
    icon: Bot,
    surface: "border-status-green-line/70 from-status-green-bg/70",
    active: "border-status-green-fg ring-1 ring-status-green-fg",
    tile: "bg-status-green-bg text-status-green-fg ring-status-green-line",
    count: "bg-status-green-bg text-status-green-fg",
    arrow: "border-status-green-line text-status-green-fg",
    arrowActive: "border-transparent bg-status-green-fg text-white",
  },
  [MAIL_BUCKETS.HUMAN]: {
    icon: Users,
    surface: "border-status-amber-line/70 from-status-amber-bg/70",
    active: "border-status-amber-fg ring-1 ring-status-amber-fg",
    tile: "bg-status-amber-bg text-status-amber-fg ring-status-amber-line",
    count: "bg-status-amber-bg text-status-amber-fg",
    arrow: "border-status-amber-line text-status-amber-fg",
    arrowActive: "border-transparent bg-status-amber-fg text-white",
  },
};

const countLabel = (count) => `${count} ${count === 1 ? "message" : "messages"}`;

function BucketCard({ bucket, count, active, descriptionId, onSelect }) {
  const meta = MAIL_BUCKET_META[bucket];
  const style = STYLE[bucket];
  const Icon = style.icon;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${meta.label}, ${countLabel(count)}`}
      aria-describedby={descriptionId}
      onClick={() => onSelect(bucket)}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border bg-linear-to-r via-card to-card px-4 py-3.5 text-left transition-[box-shadow,border-color] duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        style.surface,
        active ? cn("shadow-card-hover", style.active) : "shadow-card hover:shadow-card-hover",
      )}
    >
      <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", style.tile)}>
        <Icon className="h-5.5 w-5.5" strokeWidth={1.9} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-heading text-[15px] font-bold leading-tight text-ink">{meta.label}</span>
          <span className={cn("rounded-md px-1.5 py-px text-[11.5px] font-bold tabular-nums", style.count)}>
            {count.toLocaleString("en-IN")}
          </span>
        </span>
        <span id={descriptionId} className="mt-1 block text-[12px] font-medium leading-4 text-ink-muted">
          {meta.description}
        </span>
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
          active ? style.arrowActive : cn("bg-card", style.arrow),
        )}
      >
        <ChevronRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

/** All Mails · Auto Reply · Human Intervention, each with how many mails it holds. */
export function MailBucketTabs({ value, counts = {}, onChange }) {
  const baseId = useId();

  return (
    <div role="group" aria-label="Mailbox views" className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
      {Object.values(MAIL_BUCKETS).map((bucket) => (
        <BucketCard
          key={bucket}
          bucket={bucket}
          count={counts[bucket] ?? 0}
          active={value === bucket}
          descriptionId={`${baseId}-${bucket}`}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}
