import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, ChevronLeft, ChevronRight } from 'lucide-react';

import { navItemsForRole } from '@/constants/navigation';
import { ROLE_LABELS } from '@/constants/roles';
import { SECTION } from '@/constants/routeSections';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { cn } from '@/utils/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';


const STORAGE_KEY = 'qms.sidebar.collapsed';
const WIDTH_OPEN = 240;

export const RAIL_ITEM = 44;
export const RAIL_PADDING = 16;
export const WIDTH_CLOSED = RAIL_ITEM + RAIL_PADDING * 2;

const RAIL_SQUARE = 'h-11 w-11 shrink-0 items-center justify-center rounded-[10px]';
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0';

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function ZoneDivider({ open }) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-px bg-blue-400/20', open ? 'mx-4 my-3' : 'mx-auto my-3 w-8')}
    />
  );
}

function RailTooltip({ open, label, children }) {
  if (open) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={12}
        className="bg-sidebar-tooltip text-white border-blue-500/30 font-medium"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const open = !collapsed;

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const items = navItemsForRole(currentUser?.role);

  return (
    <TooltipProvider delayDuration={150}>
      <motion.aside
        initial={false}
        animate={{ width: open ? WIDTH_OPEN : WIDTH_CLOSED }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="relative z-10 flex h-screen shrink-0 flex-col overflow-hidden border-r border-blue-900/40 bg-linear-to-b from-sidebar-from via-sidebar-via to-sidebar-to text-white shadow-xl shadow-blue-950/20 transition-all duration-200 select-none"
      >
        <div className="pointer-events-none absolute bottom-0 left-0 z-0 select-none opacity-15">
          <svg width="240" height="240" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="180" r="120" stroke="var(--color-sidebar-accent)" strokeWidth="16" strokeDasharray="12 12" />
            <circle cx="60" cy="180" r="80" stroke="var(--color-sidebar-accent-soft)" strokeWidth="8" />
          </svg>
        </div>

        <TitleSection open={open} />
        <ZoneDivider open={open} />

        {open && (
          <div className="px-4 pt-1 pb-1 text-[10.5px] font-extrabold uppercase tracking-widest text-blue-200/60 select-none">
            Main Menu
          </div>
        )}
        <nav
          aria-label="Primary"
          className={cn(
            'relative z-10 flex flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden px-3.5 py-2',
            !open && 'items-center',
          )}
        >
          {items.map((item) => (
            <NavItem key={item.path} item={item} open={open} />
          ))}
        </nav>

        <div className="relative z-10 mt-auto">
          <ZoneDivider open={open} />
          <div className={cn('flex flex-col pb-4', open ? 'px-3.5' : 'items-center px-3.5')}>
            {currentUser && <UserFooter open={open} user={currentUser} />}

            <RailTooltip open={open} label="Expand sidebar">
              <button
                type="button"
                onClick={toggle}
                aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
                className={cn(
                  'mt-2.5 flex text-blue-200/80 transition-colors hover:bg-white/10 hover:text-white',
                  FOCUS_RING,
                  open ? 'h-9 items-center justify-start gap-3 rounded-[10px] px-3' : RAIL_SQUARE + ' flex',
                )}
              >
                {open ? (
                  <>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    <span className="text-[12px] font-medium">Collapse sidebar</span>
                  </>
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </RailTooltip>
          </div>
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}

function NavItem({ item, open }) {
  const { label, path, icon: Icon, section } = item;
  const isNotifications = section === SECTION.NOTIFICATIONS;

  const link = (
    <NavLink
      to={path}
      end={section === SECTION.DASHBOARD}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'relative flex items-center rounded-2xl text-[15px] transition-all duration-150',
          FOCUS_RING,
          open ? 'gap-3.5 justify-start px-4 py-3.5' : `${RAIL_SQUARE} justify-center`,
          isActive
            ? 'bg-linear-to-r from-sidebar-active to-sidebar-active-to font-bold text-white shadow-lg shadow-blue-900/40'
            : 'font-semibold text-blue-100/90 hover:bg-white/12 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-white" : "text-blue-200")} strokeWidth={2} aria-hidden="true" />
          {open && (
            <span className="flex-1 truncate leading-none tracking-wide">
              {label}
            </span>
          )}
          {open && isNotifications && (
            <span className="ml-auto flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-blue-400/40 px-2 text-[12px] font-extrabold text-white shadow-xs">
              3
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <RailTooltip open={open} label={label}>
      {link}
    </RailTooltip>
  );
}

function TitleSection({ open }) {
  return (
    <div
      className={cn(
        'relative z-10 flex shrink-0 items-center py-4.5 transition-all',
        open ? 'px-4' : 'justify-center px-2',
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-400 via-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-950/40 border border-white/25">
          <span className="font-heading text-[17px] font-black tracking-tight text-white drop-shadow-xs">Q</span>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              transition={{ duration: 0.15 }}
              className="flex min-w-0 flex-col justify-center"
            >
              <div className="font-heading text-[20px] font-black leading-none tracking-tight text-white">
                QMS
              </div>
              <div className="mt-1 text-[10.5px] font-semibold leading-tight text-blue-200/80 truncate">
                Query Management System
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function initials(name) {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function UserFooter({ open, user }) {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const handleLogout = (e) => {
    e.stopPropagation();
    logout();
    navigate(ROUTE_PATHS.LOGIN);
  };

  const role = ROLE_LABELS[user.role];

  const avatar = (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 border border-blue-300/40 text-[13px] font-bold text-white shadow-sm">
      {initials(user.name)}
    </div>
  );

  if (!open) {
    return (
      <>
        <RailTooltip open={open} label={`${user.name} · ${role}`}>
          <div
            tabIndex={0}
            role="img"
            aria-label={`Signed in as ${user.name}, ${role}`}
            className={cn('flex transition-opacity hover:opacity-80', RAIL_SQUARE, FOCUS_RING)}
          >
            {avatar}
          </div>
        </RailTooltip>

        <RailTooltip open={open} label="Sign out">
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            className={cn(
              'mt-1 flex text-blue-200 transition-colors hover:bg-white/10 hover:text-white',
              RAIL_SQUARE,
              FOCUS_RING,
            )}
          >
            <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </RailTooltip>
      </>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2.5 rounded-xl border border-white/15 bg-white/10 p-2.5 backdrop-blur-xs transition-colors hover:bg-white/15">
      <div className="flex items-center gap-2.5 min-w-0">
        {avatar}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[13px] font-bold leading-tight text-white">
            {user.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] font-medium leading-tight text-blue-200/80">
            {role}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        title="Sign out"
        aria-label="Sign out"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-blue-200/80 hover:bg-white/15 hover:text-white transition-colors cursor-pointer shrink-0"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
