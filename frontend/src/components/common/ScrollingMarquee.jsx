import React, { useState } from "react";
import { CheckCircle2, Info, Megaphone, X } from "lucide-react";
import { IPC_ANNOUNCEMENTS } from "@/constants/announcements";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function AnnouncementDialog({ announcement, onClose }) {
  if (!announcement) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="block max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl border-line bg-surface p-4 text-base text-ink shadow-2xl sm:max-w-lg sm:p-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
              {React.createElement(announcement.icon, { className: "h-5 w-5" })}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${announcement.badgeColor}`}
                >
                  {announcement.category} ({announcement.categoryHi})
                </span>
                <span className="rounded-md bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                  {announcement.refCode}
                </span>
              </div>
              <DialogTitle className="mt-1 text-base font-semibold leading-normal text-ink">
                {announcement.title}
              </DialogTitle>
              <p className="mt-0.5 text-xs font-medium text-primary">{announcement.titleHi}</p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close announcement details"
            onClick={onClose}
            className="cursor-pointer rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 py-5">
          <div className="rounded-xl bg-surface-muted p-4">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              <Info className="h-3.5 w-3.5 text-primary" /> Executive Summary / विवरणी
            </h4>
            <p className="text-sm leading-relaxed text-ink-soft">{announcement.summary}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-line p-3">
              <span className="mb-0.5 block font-medium text-ink-muted">Issue Date</span>
              <span className="font-semibold text-ink">{announcement.date}</span>
            </div>
            <div className="rounded-xl border border-line p-3">
              <span className="mb-0.5 block font-medium text-ink-muted">Authority</span>
              <span className="font-semibold text-ink">IPC MoHFW, Govt of India</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-muted"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledge Bulletin
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScrollingMarquee({ className = "" }) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);

  const marqueeItems = [
    ...IPC_ANNOUNCEMENTS.map((item) => ({ item, key: `${item.id}-a` })),
    ...IPC_ANNOUNCEMENTS.map((item) => ({ item, key: `${item.id}-b` })),
  ];

  return (
    <div className={`select-none border-b border-line bg-surface ${className}`}>
      <div className="flex items-center">
        <span className="flex shrink-0 items-center gap-2 self-stretch bg-primary-50 px-4 text-[12px] font-semibold text-primary lg:px-7">
          <Megaphone className="h-4 w-4 rtl:-scale-x-100" />
          <span className="hidden sm:inline">Bulletins</span>
        </span>
        <div className="relative flex-1 overflow-hidden py-1.5" dir="ltr">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-linear-to-r from-surface to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-surface to-transparent" />

          <div
            style={{ animationDuration: "130s" }}
            className="animate-marquee-scroll flex items-center gap-2 whitespace-nowrap"
          >
            {marqueeItems.map(({ item, key }) => (
              <button
                type="button"
                key={key}
                onClick={() => setSelectedAnnouncement(item)}
                className="group/item flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-surface-muted"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${item.dotColor}`} />
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${item.badgeColor}`}
                >
                  {item.category}
                </span>
                <span className="text-[13px] font-medium text-ink transition-colors group-hover/item:text-primary">
                  {item.title}
                </span>
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                  {item.refCode}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnnouncementDialog
        announcement={selectedAnnouncement}
        onClose={() => setSelectedAnnouncement(null)}
      />
    </div>
  );
}
