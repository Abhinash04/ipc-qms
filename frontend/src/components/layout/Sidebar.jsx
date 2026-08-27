import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';

import { navItemsForRole } from '@/constants/navigation';
import { SECTION } from '@/constants/routeSections';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { cn } from '@/utils/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STORAGE_KEY = 'qms.sidebar.collapsed';
const WIDTH_OPEN = 255;

export const RAIL_ITEM = 44;
export const RAIL_PADDING = 16;
export const WIDTH_CLOSED = RAIL_ITEM + RAIL_PADDING * 2;

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-0';

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function RailTooltip({ open, label, children }) {
  if (open) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={14}
        className="bg-slate-900 text-white border border-slate-700 font-extrabold text-xs shadow-2xl backdrop-blur-md"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const notifications = useWorkflowStore((state) => state.notifications);
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const open = !collapsed;

  const notifCount = notifications.filter((n) => n.recipientRole === currentUser?.role).length;

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage error
      }
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    navigate(ROUTE_PATHS.LOGIN);
  };

  const items = navItemsForRole(currentUser?.role).filter((item) => item.section !== SECTION.NOTIFICATIONS);

  return (
    <TooltipProvider delayDuration={150}>
      <motion.aside
        initial={false}
        animate={{ width: open ? WIDTH_OPEN : WIDTH_CLOSED }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-20 flex h-screen shrink-0 flex-col overflow-hidden p-3 select-none"
      >
        {/* Main Requested linear-gradient(to top, #accbee 0%, #e7f0fd 100%) Container */}
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-white/80 bg-[linear-gradient(to_top,#accbee_0%,#e7f0fd_100%)] text-slate-900 shadow-[0_16px_40px_rgba(172,203,238,0.3)] backdrop-blur-2xl">
          
          {/* Subtle Glow Light Effects */}
          <div className="pointer-events-none absolute inset-0 z-0 opacity-40">
            <div className="absolute -left-12 -top-12 h-52 w-52 rounded-full bg-white/30 blur-3xl" />
            <div className="absolute -right-12 top-1/2 h-56 w-56 rounded-full bg-rose-300/30 blur-3xl" />
          </div>

          {/* Top Header Anuvadini Logo Section & Collapse Button */}
          <div
            className={cn(
              'relative z-10 flex shrink-0 items-center py-3.5 transition-all border-b border-white/30',
              open ? 'px-4 justify-between' : 'flex-col justify-center gap-2.5 px-2 pb-3',
            )}
          >
            <div className="flex items-center min-w-0 flex-1 justify-center">
              {open ? (
                <img
                  src="/anuvadini_new_logo 2.png"
                  alt="Anuvadini Logo"
                  className="object-contain mix-blend-multiply transition-all filter drop-shadow-xs w-[210px] sm:w-[235px] h-[75px] sm:h-[85px] scale-110"
                />
              ) : (
                <img
                  src="/anuvadini-icon.png"
                  alt="Anuvadini Icon"
                  className="object-contain mix-blend-multiply transition-all filter drop-shadow-xs h-10 w-10 p-0.5"
                />
              )}
            </div>

            {/* Collapse / Expand Chevron Button */}
            <button
              type="button"
              onClick={toggle}
              title={open ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
              className={cn(
                'flex items-center justify-center text-slate-900 shadow-2xs border border-white/50 transition-all cursor-pointer shrink-0 hover:bg-white/50',
                open ? 'h-7.5 w-7.5 rounded-xl bg-white/35' : 'h-8.5 w-8.5 rounded-full bg-white/35',
              )}
            >
              <ChevronLeft
                className={cn('h-4 w-4 transition-transform duration-200', !open && 'rotate-180')}
              />
            </button>
          </div>

          {/* Navigation Section Items */}
          <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden py-3">

            <nav
              aria-label="Primary"
              className={cn('flex flex-col gap-2', open ? 'px-3' : 'items-center px-2')}
            >
              {items.map((item) => (
                <NavItem key={item.path} item={item} open={open} notifCount={notifCount} />
              ))}
            </nav>
          </div>

          {/* Bottom Sign Out Area with Original QMS Hexagon Logo above it */}
          <div className="relative z-10 p-3 border-t border-white/30 bg-white/20 backdrop-blur-md flex flex-col gap-2.5 justify-center items-center">
            
            {/* Original QMS Hexagon Logo Badge above Sign Out Button */}
            <RailTooltip open={open} label="IPC-QMS — Quality Management System">
              <div
                className={cn(
                  'flex items-center gap-2.5 rounded-2xl bg-white/50 border border-white/70 shadow-2xs transition-all',
                  open ? 'w-full px-3 py-2' : 'h-10 w-10 justify-center p-0 rounded-full',
                )}
              >
                <div className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#2563eb_0%,#6366f1_50%,#8b5cf6_100%)] text-white shadow-xs">
                  <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M12 2L20.66 7V17L12 22L3.34 17V7L12 2Z"
                      stroke="white"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 7.5L16.33 10V15L12 17.5L7.67 15V10L12 7.5Z"
                      stroke="white"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                {open && (
                  <div className="flex min-w-0 flex-col justify-center">
                    <div className="font-heading text-[13px] font-black leading-none text-slate-900 truncate">
                      IPC-QMS
                    </div>
                    <div className="mt-0.5 text-[9.5px] font-bold text-slate-700 truncate">
                      Quality Management System
                    </div>
                  </div>
                )}
              </div>
            </RailTooltip>

            <RailTooltip open={open} label="Sign out session">
              <button
                type="button"
                onClick={handleLogout}
                className={cn(
                  'flex items-center justify-center font-black transition-all duration-200 cursor-pointer border',
                  'bg-white/40 hover:bg-rose-600 text-slate-900 hover:text-white border-white/60 hover:border-rose-600 active:scale-[0.98]',
                  open ? 'w-full py-2.5 px-3 rounded-2xl gap-2 text-xs shadow-2xs' : 'h-10 w-10 rounded-full text-sm',
                )}
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={2.4} />
                {open && <span>Sign out session</span>}
              </button>
            </RailTooltip>

          </div>

        </div>
      </motion.aside>
    </TooltipProvider>
  );
}

function NavItem({ item, open, notifCount }) {
  const { label, path, icon: Icon, section } = item;
  const isNotifications = section === SECTION.NOTIFICATIONS;

  return (
    <RailTooltip open={open} label={label}>
      <NavLink
        to={path}
        end={section === SECTION.DASHBOARD}
        aria-label={label}
        className={({ isActive }) =>
          cn(
            'group relative flex items-center transition-all duration-200',
            FOCUS_RING,
            open
              ? 'gap-3 px-3.5 py-3 rounded-2xl text-xs'
              : 'h-10 w-10 rounded-full justify-center text-xs border border-white/40',
            isActive
              ? 'bg-[linear-gradient(135deg,#2563eb_0%,#6366f1_50%,#8b5cf6_100%)] text-white font-black shadow-lg shadow-indigo-500/25 border border-white/30'
              : 'font-black text-slate-800/90 hover:bg-white/40 hover:text-slate-950 border-white/40',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              className={cn(
                'h-4.5 w-4.5 shrink-0 transition-transform duration-200 group-hover:scale-105',
                isActive ? 'text-white drop-shadow-xs' : 'text-slate-800 group-hover:text-slate-950',
              )}
              strokeWidth={2.4}
              aria-hidden="true"
            />

            {open && (
              <span className="flex-1 truncate leading-none tracking-tight text-[13px]">
                {label}
              </span>
            )}

            {/* Notification Badge in Expanded State */}
            {open && isNotifications && notifCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-black text-white shadow-xs">
                {notifCount}
              </span>
            )}

            {/* Notification Dot Badge in Collapsed Rail State */}
            {!open && isNotifications && notifCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white shadow-xs border border-white">
                {notifCount}
              </span>
            )}

            {open && !isActive && (
              <ChevronRight className="h-3.5 w-3.5 text-slate-700/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto" />
            )}
          </>
        )}
      </NavLink>
    </RailTooltip>
  );
}
