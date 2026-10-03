import { useId } from "react";
import { ArrowRight, Check, Inbox, Sparkles } from "lucide-react";

import {
  CATEGORY_ORDER,
  MAIL_CATEGORIES,
  MAIL_CATEGORY_META,
  REGISTERED,
  REGISTERED_META,
  UNCLASSIFIED,
} from "@/constants/mailCategories";
import { cn } from "@/utils/cn";

export const ALL_CATEGORIES = "all";

const ALL_META = {
  tab: "All",
  icon: Inbox,
  tone: "primary",
  description: "Every message in this view",
};

const TONE_CLASSES = {
  primary: {
    surface: "border-primary-100 from-primary-50",
    halo: "ring-primary-100",
    ink: "text-primary-700",
    outline: "outline-primary",
    arrow: "border-primary-200 text-primary",
    arrowActive: "bg-primary",
  },
  green: {
    surface: "border-status-green-line/70 from-status-green-bg",
    halo: "ring-status-green-line",
    ink: "text-status-green-fg",
    outline: "outline-status-green-fg",
    arrow: "border-status-green-line text-status-green-fg",
    arrowActive: "bg-status-green-fg",
  },
  blue: {
    surface: "border-status-blue-line/70 from-status-blue-bg",
    halo: "ring-status-blue-line",
    ink: "text-status-blue-fg",
    outline: "outline-status-blue-fg",
    arrow: "border-status-blue-line text-status-blue-fg",
    arrowActive: "bg-status-blue-fg",
  },
  amber: {
    surface: "border-status-amber-line/70 from-status-amber-bg",
    halo: "ring-status-amber-line",
    ink: "text-status-amber-fg",
    outline: "outline-status-amber-fg",
    arrow: "border-status-amber-line text-status-amber-fg",
    arrowActive: "bg-status-amber-fg",
  },
  purple: {
    surface: "border-status-purple-line/70 from-status-purple-bg",
    halo: "ring-status-purple-line",
    ink: "text-status-purple-fg",
    outline: "outline-status-purple-fg",
    arrow: "border-status-purple-line text-status-purple-fg",
    arrowActive: "bg-status-purple-fg",
  },
  red: {
    surface: "border-status-red-line/70 from-status-red-bg",
    halo: "ring-status-red-line",
    ink: "text-status-red-fg",
    outline: "outline-status-red-fg",
    arrow: "border-status-red-line text-status-red-fg",
    arrowActive: "bg-status-red-fg",
  },
  indigo: {
    surface: "border-status-indigo-line/70 from-status-indigo-bg",
    halo: "ring-status-indigo-line",
    ink: "text-status-indigo-fg",
    outline: "outline-status-indigo-fg",
    arrow: "border-status-indigo-line text-status-indigo-fg",
    arrowActive: "bg-status-indigo-fg",
  },
  gray: {
    surface: "border-status-gray-line from-status-gray-bg",
    halo: "ring-status-gray-line",
    ink: "text-status-gray-fg",
    outline: "outline-status-gray-fg",
    arrow: "border-status-gray-line text-status-gray-fg",
    arrowActive: "bg-status-gray-fg",
  },
};

const ART = import.meta.glob("../../assets/mail-categories/*.{webp,png}", {
  eager: true,
  import: "default",
});

const artSlug = (value) => value.toLowerCase().replaceAll("_", "-");

function artFor(value) {
  const slug = artSlug(value);
  const path = Object.keys(ART).find((key) => /\/([^/]+)\.(webp|png)$/.exec(key)?.[1] === slug);
  return path ? ART[path] : null;
}

function CategoryArt({ value, icon: Icon, tone }) {
  const src = artFor(value);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={72}
        height={72}
        decoding="async"
        draggable={false}
        className="h-18 w-18 object-contain drop-shadow-sm"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-card ring-1",
        TONE_CLASSES[tone].halo,
      )}
    >
      <Icon className={cn("h-7 w-7", TONE_CLASSES[tone].ink)} strokeWidth={1.75} />
    </span>
  );
}

const countLabel = (count) => `${count} ${count === 1 ? "message" : "messages"}`;

function CategoryCard({ value, meta, count, active, descriptionId, onSelect }) {
  const tone = TONE_CLASSES[meta.tone] ? meta.tone : "gray";
  const classes = TONE_CLASSES[tone];

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${meta.tab}, ${countLabel(count)}`}
      aria-describedby={descriptionId}
      onClick={() => onSelect(value)}
      className={cn(
        "group relative flex w-[40%] min-w-34 shrink-0 snap-start cursor-pointer flex-col items-center rounded-card border bg-linear-to-b via-card to-card px-3 pt-4 pb-3.5 text-center transition-[box-shadow,transform,border-color] duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "@md:w-auto @md:min-w-0",
        classes.surface,
        active
          ? cn("shadow-card-hover outline-2 outline-offset-2 motion-safe:-translate-y-0.5", classes.outline)
          : "shadow-card hover:shadow-card-hover motion-safe:hover:-translate-y-0.5",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-white",
            classes.arrowActive,
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}

      <span className="flex h-18 items-center justify-center">
        <CategoryArt value={value} icon={meta.icon} tone={tone} />
      </span>

      <span className="mt-3 font-heading text-[14px] font-semibold leading-tight text-ink">
        {meta.tab}
      </span>

      <span
        className={cn(
          "mt-1.5 font-heading text-[28px] font-bold leading-none tabular-nums",
          count > 0 ? classes.ink : "text-ink-muted",
        )}
      >
        {count.toLocaleString("en-IN")}
      </span>

      <span
        id={descriptionId}
        className="mt-2 line-clamp-2 min-h-8 text-[11.5px] font-medium leading-4 text-ink-muted"
      >
        {meta.description}
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "mt-3 flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          active ? cn("border-transparent text-white", classes.arrowActive) : cn("bg-card", classes.arrow),
        )}
      >
        <ArrowRight className="h-3.5 w-3.5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function ClassifyingNote({ count }) {
  if (!count) return null;

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-status-amber-line bg-status-amber-bg px-2.5 py-1 text-[11.5px] font-bold text-status-amber-fg"
    >
      <span aria-hidden="true" className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-status-amber-fg opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-status-amber-fg" />
      </span>
      {count.toLocaleString("en-IN")} being classified
    </span>
  );
}

export function MailCategoryCards({ value, counts, onChange }) {
  const baseId = useId();
  const total = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const bucket = (key) => ({ value: key, meta: MAIL_CATEGORY_META[key], count: counts[key] ?? 0 });
  const cards = [
    { value: ALL_CATEGORIES, meta: ALL_META, count: total },
    ...CATEGORY_ORDER.filter((key) => key !== MAIL_CATEGORIES.OTHER).map(bucket),
    { value: REGISTERED, meta: REGISTERED_META, count: counts[REGISTERED] ?? 0 },
    bucket(MAIL_CATEGORIES.OTHER),
  ];

  return (
    <section aria-labelledby={`${baseId}-title`} className="@container mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary ring-1 ring-primary-100"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h3 id={`${baseId}-title`} className="m-0 font-heading text-[14.5px] font-semibold text-ink">
              AI-sorted categories
            </h3>
            <p className="m-0 text-[12px] font-medium text-ink-muted">
              BRIDGETECH AI files every incoming email into a bucket. Counts follow your search and view.
            </p>
          </div>
        </div>
        <ClassifyingNote count={counts[UNCLASSIFIED] ?? 0} />
      </div>

      <div
        role="group"
        aria-label="Filter by category"
        className="-mx-1.5 flex snap-x snap-mandatory scroll-px-1.5 gap-3 overflow-x-auto px-1.5 pt-2 pb-3 scrollbar-none @md:mx-0 @md:grid @md:grid-cols-3 @md:overflow-visible @md:px-0 @2xl:grid-cols-4 @6xl:grid-cols-8"
      >
        {cards.map((card) => (
          <CategoryCard
            key={card.value}
            value={card.value}
            meta={card.meta}
            count={card.count}
            active={value === card.value}
            descriptionId={`${baseId}-${card.value}`}
            onSelect={onChange}
          />
        ))}
      </div>
    </section>
  );
}
