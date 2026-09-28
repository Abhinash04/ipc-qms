import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, Inbox, Clock, Tag, X, ExternalLink } from "lucide-react";

import { sectionPath, buildPath } from "@/constants/routePaths";
import { SECTION } from "@/constants/routeSections";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ROLE_LABELS } from "@/constants/roles";
import { stableKey } from "@/utils/stableKey";
import { activateOnKey } from "@/utils/a11y";
import { NAV_ICON_BUTTON } from "@/components/layout/navbarStyles";

function formatNotificationTime(notif) {
  if (!notif) return "Just now";
  if (notif.time) return notif.time;
  const iso = notif.at || notif.createdAt || notif.timestamp;
  if (!iso) return "Just now";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Just now";
  const diffMs = Date.now() - then.getTime();
  if (diffMs < 0) return "Just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function NotificationBell() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const notifications = useWorkflowStore((state) => state.notifications);
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [activeModalNotif, setActiveModalNotif] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ top: 72, right: 24 });

  const bellRef = useRef(null);
  const popoverRef = useRef(null);

  const userNotifications = notifications.filter((n) =>
    n.recipientUserId
      ? n.recipientUserId === currentUser?.id
      : n.recipientRole === currentUser?.role,
  );
  const count = userNotifications.length;

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      if (!bellRef.current) return;
      const rect = bellRef.current.getBoundingClientRect();
      const width = window.innerWidth < 640 ? 336 : 384;
      const idealRight = Math.max(16, window.innerWidth - rect.right);
      const maxRight = window.innerWidth - width - 16;
      setPopoverPos({
        top: rect.bottom + 10,
        right: Math.min(idealRight, Math.max(16, maxRight)),
      });
    };
    const handleClickOutside = (event) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target) &&
        bellRef.current &&
        !bellRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleNotificationClick = (notif) => {
    setIsOpen(false);
    if (notif.queryId && currentUser?.role) {
      try {
        const detail = sectionPath(currentUser.role, SECTION.QUERY_DETAIL);
        navigate(buildPath(detail, { queryId: notif.queryId }));
      } catch {
        setActiveModalNotif(notif);
      }
    } else {
      setActiveModalNotif(notif);
    }
  };

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={NAV_ICON_BUTTON}
        title={`Notifications (${count} new)`}
        aria-label={`Notifications (${count} unread)`}
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -inset-e-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">
            {count}
          </span>
        )}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Notifications"
            style={{
              position: "fixed",
              top: `${popoverPos.top}px`,
              right: `${popoverPos.right}px`,
              zIndex: 60,
            }}
            className="w-84 sm:w-96 max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl select-none"
            data-slot="popover-content"
            data-state="open"
          >
            <div className="flex items-center justify-between bg-primary px-4 py-3.5 text-white">
              <div>
                <h2 className="font-heading text-sm font-semibold leading-none">
                  All Notifications
                </h2>
                <p className="mt-1 text-[11px] text-white/75">
                  {ROLE_LABELS[currentUser?.role]} activity
                </p>
              </div>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">
                {count > 0 ? `${count} unread` : "Up to date"}
              </span>
            </div>

            <div className="max-h-96 overflow-y-auto p-2">
              {userNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-ink-muted">
                    <Inbox className="h-5.5 w-5.5" />
                  </div>
                  <p className="text-xs font-semibold text-ink">No new notifications</p>
                  <p className="max-w-55 text-[11px] text-ink-muted">
                    All incoming query updates for {ROLE_LABELS[currentUser?.role]} will
                    appear here.
                  </p>
                </div>
              ) : (
                userNotifications.map((notif) => (
                  <div
                    key={notif.notificationId || notif.id || stableKey(notif)}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotificationClick(notif)}
                    onKeyDown={activateOnKey(() => handleNotificationClick(notif))}
                    className="group flex w-full cursor-pointer items-start gap-3 rounded-xl p-3 text-start transition-colors hover:bg-primary-50 focus-visible:bg-primary-50 outline-none"
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
                      <CheckCircle2 className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink group-hover:text-primary">
                          {notif.title || `Query ${notif.queryId || "Update"}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-ink-muted">
                          <Clock className="h-3 w-3" />
                          {formatNotificationTime(notif)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-muted">
                        {notif.message || notif.text}
                      </p>
                      {notif.queryId && (
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-soft">
                            <Tag className="h-2.5 w-2.5 text-primary" />
                            {notif.queryId}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary group-hover:underline">
                            Open details
                            <ExternalLink className="h-2.5 w-2.5" />
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}

      {activeModalNotif &&
        createPortal(
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs select-none">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Notification details"
              className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-heading text-sm font-semibold text-ink">
                      Notification Details
                    </h2>
                    <p className="text-xs text-ink-muted">
                      {formatNotificationTime(activeModalNotif)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close notification details"
                  onClick={() => setActiveModalNotif(null)}
                  className="cursor-pointer rounded-lg p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-ink">
                  {activeModalNotif.title ||
                    `Notification ${activeModalNotif.queryId || ""}`}
                </h3>
                <p className="rounded-xl bg-surface-muted p-3.5 text-xs leading-relaxed text-ink-soft">
                  {activeModalNotif.message || activeModalNotif.text}
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModalNotif(null)}
                  className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-hover"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
