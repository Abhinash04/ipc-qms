import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  RotateCcwIcon,
  Bell,
  CheckCircle2,
  Inbox,
  Clock,
  Tag,
  X,
  ExternalLink,
} from "lucide-react";

import { roleHome, sectionPath, buildPath } from "@/constants/routePaths";
import { SECTION } from "@/constants/routeSections";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ROLE_LABELS } from "@/constants/roles";
import { MOCK_USERS, findUserById } from "@/constants/mockUsers";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { IpcLogo } from "@/components/common/IpcLogo";

const SWITCHABLE_USERS = MOCK_USERS;

function initials(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function Header() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const resetDemo = useWorkflowStore((state) => state.resetDemo);
  const persistenceError = useWorkflowStore((state) => state.persistenceError);
  const notifications = useWorkflowStore((state) => state.notifications);

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [activeModalNotif, setActiveModalNotif] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ top: 90, right: 24 });

  const bellRef = useRef(null);
  const notifRef = useRef(null);

  const userNotifications = notifications.filter(
    (n) => n.recipientRole === currentUser?.role,
  );
  const notifCount = userNotifications.length;

  const updatePopoverPos = () => {
    if (bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect();
      const idealRight = Math.max(16, window.innerWidth - rect.right);
      const popoverWidth = window.innerWidth < 640 ? 336 : 384; 
      
      const maxRight = window.innerWidth - popoverWidth - 16;
      const actualRight = Math.min(idealRight, Math.max(16, maxRight));

      setPopoverPos({
        top: rect.bottom + 10,
        right: actualRight,
      });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        notifRef.current &&
        !notifRef.current.contains(event.target) &&
        bellRef.current &&
        !bellRef.current.contains(event.target)
      ) {
        setIsNotifOpen(false);
      }
    };

    if (isNotifOpen) {
      updatePopoverPos();
      window.addEventListener("resize", updatePopoverPos);
      window.addEventListener("scroll", updatePopoverPos);
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        window.removeEventListener("resize", updatePopoverPos);
        window.removeEventListener("scroll", updatePopoverPos);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isNotifOpen]);

  const switchUser = (userId) => {
    login(userId);
    navigate(roleHome(findUserById(userId)?.role));
  };

  const handleNotificationClick = (notif) => {
    setIsNotifOpen(false);
    if (notif.queryId && currentUser?.role) {
      try {
        const queryDetailPath = sectionPath(
          currentUser.role,
          SECTION.QUERY_DETAIL,
        );
        const targetPath = buildPath(queryDetailPath, {
          queryId: notif.queryId,
        });
        navigate(targetPath);
      } catch {
        setActiveModalNotif(notif);
      }
    } else {
      setActiveModalNotif(notif);
    }
  };

  return (
    <header className="relative z-30 px-3 pt-4 sm:px-5 sm:pt-5 lg:px-7">
      <div className="pointer-events-none absolute inset-x-10 top-4 h-20 rounded-full bg-[radial-gradient(circle,rgba(124,77,255,0.12)_0%,rgba(52,120,246,0.1)_40%,rgba(255,255,255,0)_75%)] blur-2xl" />
      <div className="glass-panel aurora-panel flex flex-col lg:flex-row min-h-20 lg:items-center justify-between rounded-3xl sm:rounded-[28px] px-3 sm:px-5 py-3 gap-4 lg:gap-0">
        <div className="flex flex-col sm:flex-row lg:items-center gap-3 sm:gap-6 w-full lg:w-auto">
          <IpcLogo size="md" variant="light" className="w-full sm:w-auto" />

          {persistenceError && (
            <div className="hidden xl:flex items-center gap-3 pl-4 border-l border-white/50">
              <span
                className="glass-pill inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-bold bg-red-50 border-red-200 text-red-700"
                title={persistenceError}
              >
                Storage unavailable
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto justify-end sm:justify-start lg:justify-end">
          <div className="relative">
            <button
              ref={bellRef}
              onClick={() => setIsNotifOpen((prev) => !prev)}
              className="glass-control relative flex items-center justify-center h-9 w-9 rounded-full text-slate-600 hover:text-indigo-600 transition-all hover:-translate-y-0.5 focus:outline-none cursor-pointer"
              title={`Notifications (${notifCount} new)`}
              aria-label={`Notifications (${notifCount} unread)`}
            >
              <Bell className="h-4.5 w-4.5 text-slate-700" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white shadow-xs border border-white">
                  {notifCount}
                </span>
              )}
            </button>
          </div>

          <button
            onClick={resetDemo}
            className="glass-control flex h-auto items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-slate-600 transition-all hover:-translate-y-0.5 hover:text-rose-600 focus:outline-none cursor-pointer"
            title="Reset database to initial state"
          >
            <RotateCcwIcon className="h-4 w-4" />
            <span className="hidden sm:inline-block">Reset</span>
          </button>

          <div className="flex items-center gap-2.5">
            <Select value={currentUser?.id || ""} onValueChange={switchUser}>
              <SelectTrigger className="glass-control flex h-auto items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-slate-800 transition-all hover:-translate-y-0.5 focus:ring-0 focus:ring-offset-0 cursor-pointer [&>svg]:text-purple-600">
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7C4DFF,#3478F6)] text-[10.5px] font-black text-white shadow-[0_8px_16px_rgba(124,77,255,0.3)]">
                      {initials(currentUser?.name)}
                    </div>
                    <span className="font-extrabold text-slate-800">
                      {currentUser?.name}
                    </span>
                    <span className="hidden lg:inline-block text-slate-400 font-medium">
                      — {ROLE_LABELS[currentUser?.role]}
                    </span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="glass-panel w-77.5 max-h-96 rounded-2xl p-1.5 shadow-xl z-50">
                {SWITCHABLE_USERS.map((user) => (
                  <SelectItem
                    key={user.id}
                    value={user.id}
                    className="rounded-xl px-3 py-2.5 cursor-pointer transition-colors hover:bg-white/80"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3e8ff] text-status-purple-fg text-[11px] font-extrabold shrink-0 border border-purple-200/50">
                        {initials(user.name)}
                      </span>
                      <span className="text-[13px] font-extrabold text-slate-800 leading-tight">
                        {user.name}{" "}
                        <span className="font-medium text-slate-400">
                          — {ROLE_LABELS[user.role]}
                        </span>
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      {isNotifOpen &&
        createPortal(
          <div
            ref={notifRef}
            style={{
              position: "fixed",
              top: `${popoverPos.top}px`,
              right: `${popoverPos.right}px`,
              zIndex: 999999,
            }}
            className="w-84 sm:w-96 max-w-[calc(100vw-32px)] rounded-2xl border border-slate-200/90 bg-white/98 p-4.5 shadow-[0_25px_80px_rgba(15,23,42,0.35)] backdrop-blur-3xl transition-all animate-in fade-in zoom-in-95 duration-150 select-none"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/80">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-black text-slate-900 leading-none">
                    Notifications
                  </h3>
                  <p className="text-[10.5px] font-semibold text-slate-400 mt-0.5">
                    {ROLE_LABELS[currentUser?.role]} Activity
                  </p>
                </div>
              </div>
              {notifCount > 0 ? (
                <span className="rounded-full bg-rose-50 border border-rose-200/70 px-2.5 py-0.5 text-[10.5px] font-black text-rose-600">
                  {notifCount} unread
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-500">
                  Up to date
                </span>
              )}
            </div>

            {/* Scrollable Notification Items List */}
            <div className="my-3 max-h-80 overflow-y-auto space-y-2.5 pr-1 text-slate-800">
              {userNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-9 text-center text-slate-400 space-y-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100 text-slate-300">
                    <Inbox className="h-5.5 w-5.5" />
                  </div>
                  <p className="text-xs font-bold text-slate-600">
                    No new notifications
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-55">
                    All incoming query updates for{" "}
                    {ROLE_LABELS[currentUser?.role]} will appear here.
                  </p>
                </div>
              ) : (
                userNotifications.map((notif, index) => (
                  <div
                    key={notif.id || index}
                    onClick={() => handleNotificationClick(notif)}
                    className="group relative flex items-start gap-3 p-3 rounded-xl border border-slate-100/90 hover:border-indigo-300 bg-slate-50/70 hover:bg-indigo-50/40 transition-all duration-200 cursor-pointer shadow-2xs hover:shadow-xs"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100/80 text-indigo-600 mt-0.5 group-hover:scale-105 transition-transform">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[12.5px] font-bold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                          {notif.title || `Query ${notif.queryId || "Update"}`}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 shrink-0">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>{notif.time || "Just now"}</span>
                        </div>
                      </div>
                      <p className="text-[11.5px] font-medium text-slate-600 line-clamp-2 mt-1 leading-snug">
                        {notif.message || notif.text}
                      </p>
                      {notif.queryId && (
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-slate-600">
                            <Tag className="h-2.5 w-2.5 text-indigo-500" />
                            {notif.queryId}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-indigo-600 group-hover:underline">
                            <span>Open details</span>
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
          <div className="fixed inset-0 z-999999 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200 select-none">
            <div className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-extrabold text-slate-900">
                      Notification Details
                    </h3>
                    <p className="text-xs text-slate-400">
                      {activeModalNotif.time || "Recent Alert"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveModalNotif(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  {activeModalNotif.title ||
                    `Notification ${activeModalNotif.queryId || ""}`}
                </h4>
                <p className="text-xs leading-relaxed text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium">
                  {activeModalNotif.message || activeModalNotif.text}
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setActiveModalNotif(null)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
}
