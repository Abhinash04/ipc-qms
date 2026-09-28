import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IPC_ANNOUNCEMENTS } from "@/constants/announcements";
import { AnnouncementDialog } from "@/components/common/ScrollingMarquee";
import { HeroBackdrop } from "@/components/common/HeroBackdrop";
import { greetingPeriod } from "@/utils/greeting";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";

const ROTATE_MS = 7000;

function AnnouncementCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState(null);
  const count = IPC_ANNOUNCEMENTS.length;

  useEffect(() => {
    if (paused || open) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, open, count]);

  const item = IPC_ANNOUNCEMENTS[index];
  const Icon = item.icon;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="IPC bulletins"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="w-full rounded-2xl border border-white/20 bg-white/10 p-4 text-white backdrop-blur-md lg:w-96"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
          Bulletin {index + 1} / {count}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous bulletin"
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next bulletin"
            onClick={() => setIndex((i) => (i + 1) % count)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(item)}
        aria-live={paused ? "polite" : "off"}
        className="mt-3 flex w-full cursor-pointer items-start gap-3 text-start"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11.5px] font-medium text-white/75">{item.category}</span>
          <span className="line-clamp-2 block text-[14px] font-semibold leading-snug">
            {item.title}
          </span>
        </span>
      </button>

      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {IPC_ANNOUNCEMENTS.map((a, i) => (
          <span
            key={a.id}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-5 bg-white" : "w-1.5 bg-white/40",
            )}
          />
        ))}
      </div>

      {createPortal(
        <AnnouncementDialog announcement={open} onClose={() => setOpen(null)} />,
        document.body,
      )}
    </section>
  );
}

export function DashboardHero({ userName, title, purpose, actions }) {
  const t = useT();
  const firstName = userName ? userName.split(" ")[0] : "";
  const greeting = `${t(`dashboard.greeting.${greetingPeriod()}`)}${firstName ? `, ${firstName}` : ""}`;

  return (
    <div className="relative -mx-4 -mt-6 overflow-hidden bg-primary px-4 pt-8 pb-32 text-white lg:-mx-7 lg:px-7">
      <HeroBackdrop />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-medium text-white/90">
            {greeting}
            <span className="emoji-animated emoji-wave" aria-hidden="true">
              👋
            </span>
          </p>
          <h1 className="mt-1 font-heading text-[28px] font-bold leading-tight sm:text-[34px]">
            {title}
          </h1>
          {purpose && <p className="mt-1.5 max-w-xl text-[14px] text-white/80">{purpose}</p>}
          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
        </div>
        <AnnouncementCarousel />
      </div>
    </div>
  );
}
