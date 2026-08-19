import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, FileText, ChevronLeft, ChevronRight } from 'lucide-react';

import { navItemsForRole } from '@/constants/navigation';
import { ROLE_LABELS } from '@/constants/roles';
import { SECTION } from '@/constants/routeSections';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { cn } from '@/utils/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STORAGE_KEY = 'qms.sidebar.collapsed';
const WIDTH_OPEN = 240;

/**
 * Collapsed geometry, and it has to add up exactly.
 *
 * WIDTH_CLOSED = RAIL_ITEM + 2 × RAIL_PADDING. When it did not — a 42px item in
 * a 40px content box — the 2px overflow met `overflow-y-auto` on the nav, which
 * per CSS forces the other axis to `auto` as well, and the browser painted a
 * horizontal scrollbar across the rail. That grey bar was not a design element.
 *
 * 44px is also the minimum comfortable pointer target, so every interactive
 * control in the rail is a 44 square: nav items, avatar, sign out, toggle.
 */
export const RAIL_ITEM = 44;
export const RAIL_PADDING = 16;
export const WIDTH_CLOSED = RAIL_ITEM + RAIL_PADDING * 2;

/** Shared by every rail control, so the column reads as one system. */
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

/** Ends one zone and starts the next. Short and centred in the rail. */
function ZoneDivider({ open }) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-px bg-white/10', open ? 'mx-4 my-3' : 'mx-auto my-3 w-8')}
    />
  );
}

/**
 * Wraps a control in a tooltip only while collapsed — expanded controls carry
 * their own visible label, and a tooltip repeating it is noise. The tooltip is
 * portalled, so it escapes the rail's `overflow-hidden` and shifts no layout.
 */
function RailTooltip({ open, label, children }) {
  if (open) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={8}
        className="bg-sidebar-border text-white border-sidebar-tooltip-line"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const items = navItemsForRole(currentUser?.role);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const open = !collapsed;

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  return (
    // 300ms, not the app-wide 0: at zero a tooltip fires on the slightest pass
    // of the pointer while the user is aiming at something else.
    <TooltipProvider delayDuration={300}>
      <motion.aside
        layout
        style={{ width: open ? WIDTH_OPEN : WIDTH_CLOSED }}
        className="relative z-10 flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-[linear-gradient(180deg,var(--color-sidebar-from)_0%,var(--color-sidebar-to)_100%)] text-sidebar-fg shadow-lg transition-all duration-200"
      >
        {/* Zone 1 — brand */}
        <TitleSection open={open} />
        <ZoneDivider open={open} />

        {/* Zone 2 — navigation */}
        {open && (
          <div className="px-4 pb-2 pt-2">
            <div className="ml-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-fg">
              Main Menu
            </div>
          </div>
        )}
        <nav
          aria-label="Primary"
          className={cn(
            'flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-4 py-1',
            !open && 'items-center',
          )}
        >
          {items.map((item) => (
            <NavItem key={item.path} item={item} open={open} />
          ))}
        </nav>

        {/* Zone 3 — user and sidebar controls */}
        <ZoneDivider open={open} />
        <div className={cn('flex flex-col pb-4', open ? 'px-4' : 'items-center px-4')}>
          {currentUser && <UserFooter open={open} user={currentUser} />}

          <RailTooltip open={open} label="Expand sidebar">
            <button
              type="button"
              onClick={toggle}
              aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
              className={cn(
                'mt-1 flex text-sidebar-fg transition-colors hover:bg-white/10 hover:text-white',
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
      </motion.aside>
    </TooltipProvider>
  );
}

function NavItem({ item, open }) {
  const { label, path, icon: Icon, section } = item;

  const link = (
    <NavLink
      to={path}
      end={section === SECTION.DASHBOARD}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'relative flex items-center rounded-[10px] text-[13.5px] transition-colors',
          FOCUS_RING,
          open ? 'gap-3 justify-start px-3.5 py-2.75' : `${RAIL_SQUARE} justify-center`,
          isActive
            ? 'bg-sidebar-active-soft font-medium text-white'
            : 'font-normal text-sidebar-nav hover:bg-white/10 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The signal. A rail on the edge reads as "you are here" at a glance
              without the surface having to shout. */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full bg-sidebar-accent"
            />
          )}
          <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          {open && <span className="flex-1 truncate">{label}</span>}
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
        'flex shrink-0 items-center gap-3 py-6',
        open ? 'px-4' : 'justify-center px-4',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-sidebar-active text-white shadow-sm">
        <FileText className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
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
            <div className="font-heading text-[18px] font-bold leading-[1.1] tracking-tight text-white">
              QMS
            </div>
            <div className="mt-0.75 text-[9px] font-semibold uppercase leading-none tracking-widest text-sidebar-fg">
              Query Mgmt.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-[13px] font-bold text-white shadow-md">
      {initials(user.name)}
    </div>
  );

  if (!open) {
    return (
      <>
        {/* Identity is a label, not a control — a div here would be invisible to
            a keyboard and to a screen reader alike. */}
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

        {/* Collapsing used to hide this entirely, leaving no way to sign out. */}
        <RailTooltip open={open} label="Sign out">
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            className={cn(
              'mt-1 flex text-sidebar-fg transition-colors hover:bg-white/10 hover:text-white',
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
    <div className="group flex items-center justify-start gap-3 transition-colors">
      {avatar}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-[13px] font-semibold leading-tight text-white">
          {user.name}
        </div>
        <div className="mt-0.75 truncate text-[11px] font-medium leading-tight text-sidebar-fg">
          {role}
        </div>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        aria-label="Sign out"
        className={cn(
          'shrink-0 rounded-[6px] p-1.5 text-sidebar-fg transition-colors hover:bg-white/10 hover:text-white',
          FOCUS_RING,
        )}
      >
        <LogOut className="h-3.75 w-3.75" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
