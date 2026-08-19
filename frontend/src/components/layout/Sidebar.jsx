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
const WIDTH_CLOSED = 72;

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
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
    <TooltipProvider>
      <motion.aside
        layout
        style={{ width: open ? WIDTH_OPEN : WIDTH_CLOSED }}
        className="relative flex shrink-0 flex-col bg-[linear-gradient(180deg,var(--color-sidebar-from)_0%,var(--color-sidebar-to)_100%)] text-sidebar-fg overflow-hidden transition-all duration-200 z-10 shadow-lg border-r border-sidebar-border"
      >
        <TitleSection open={open} />

        <div className={cn("px-4 pt-6 pb-2", open ? "block" : "hidden")}>
          <div className="text-[10px] font-bold text-sidebar-fg tracking-wider uppercase ml-1">
            Main Menu
          </div>
        </div>
        {!open && <div className="h-8" />}

        <nav className="flex-1 px-4 py-1 flex flex-col gap-1 overflow-y-auto" aria-label="Primary">
          {items.map((item) => (
            <NavItem key={item.path} item={item} open={open} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col px-4 pb-4">
          <div className="h-px bg-white/10 mb-4" />
          {currentUser && <UserFooter open={open} user={currentUser} />}
          
          <button
            onClick={toggle}
            className={cn(
              "flex items-center text-sidebar-fg hover:text-white transition-colors bg-transparent mt-2",
              open ? "h-8 justify-start gap-3" : "h-8 justify-center"
            )}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
          >
            {open ? (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-[12px] font-medium">Collapse sidebar</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
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
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-[10px] text-[13.5px] transition-all overflow-hidden border-none outline-none group',
          open ? 'py-2.75 px-3.5 justify-start' : 'py-3 px-0 justify-center mx-auto w-10.5',
          isActive
            ? 'bg-sidebar-active text-white font-medium shadow-[0_0_15px_rgba(37,99,235,0.3)]'
            : 'text-sidebar-nav hover:bg-white/10 hover:text-white font-normal'
        )
      }
    >
      <span className="shrink-0 flex items-center justify-center">
        <Icon className="h-4.5 w-4.5 transition-colors" strokeWidth={1.8} aria-hidden="true" />
      </span>
      {open && <span className="truncate flex-1">{label}</span>}
    </NavLink>
  );

  if (open) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="bg-sidebar-border text-white border-sidebar-tooltip-line">{label}</TooltipContent>
    </Tooltip>
  );
}

function TitleSection({ open }) {
  return (
    <div className={cn("flex items-center gap-3 shrink-0", open ? "px-4 py-6" : "px-3 py-6 justify-center")}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-sidebar-active text-white shadow-sm">
        <FileText className="h-5 w-5" strokeWidth={2} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: 0.15 }}
            className="min-w-0 flex flex-col justify-center"
          >
            <div className="font-heading text-[18px] font-bold text-white tracking-tight leading-[1.1]">QMS</div>
            <div className="text-[9px] font-semibold text-sidebar-fg tracking-widest uppercase mt-0.75 leading-none">Query Mgmt.</div>
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

  return (
    <div className={cn(
      "flex items-center gap-3 transition-colors group",
      open ? "justify-start" : "justify-center"
    )}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-[13px] font-bold text-white shadow-md">
        {initials(user.name)}
      </div>
      {open && (
        <>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="text-[13px] font-semibold text-white truncate leading-tight">{user.name}</div>
            <div className="text-[11px] font-medium text-sidebar-fg mt-0.75 truncate leading-tight">{ROLE_LABELS[user.role]}</div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="shrink-0 rounded-[6px] p-1.5 text-sidebar-fg hover:text-white hover:bg-white/10 transition-colors"
          >
            <LogOut className="h-3.75 w-3.75" strokeWidth={2} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
