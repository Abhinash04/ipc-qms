import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, ChevronsRight, LogOut } from 'lucide-react';

import { navItemsForRole } from '@/constants/navigation';
import { ROLE_LABELS } from '@/constants/roles';
import { SECTION } from '@/constants/routeSections';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STORAGE_KEY = 'qms.sidebar.collapsed';
const WIDTH_OPEN = 248;
const WIDTH_CLOSED = 68;
const labelMotion = {
  layout: true,
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  transition: { delay: 0.1 },
};

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
        /* storage unavailable — collapse still works for this session */
      }
      return next;
    });
  };

  return (
    <TooltipProvider>
      <motion.aside
        layout
        style={{ width: open ? WIDTH_OPEN : WIDTH_CLOSED }}
        className="relative flex shrink-0 flex-col border-r border-white/10 bg-primary text-primary-foreground"
      >
        <TitleSection open={open} />

        <nav
          className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4"
          aria-label="Primary"
        >
          {items.map((item) => (
            <NavItem key={item.path} item={item} open={open} />
          ))}
        </nav>

        {currentUser && <UserFooter open={open} user={currentUser} />}
        <ToggleClose open={open} onToggle={toggle} />
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
          'relative flex h-10 items-center rounded-md text-sm transition-colors',
          isActive
            ? 'bg-white/10 font-medium text-primary-foreground'
            : 'text-white/60 hover:bg-white/5 hover:text-primary-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-ring opacity-0 transition-opacity',
              isActive && 'opacity-100',
            )}
            aria-hidden="true"
          />
          <span className="grid h-full w-11 shrink-0 place-content-center">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          {open && (
            <motion.span {...labelMotion} className="truncate pr-3">
              {label}
            </motion.span>
          )}
        </>
      )}
    </NavLink>
  );

  if (open) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function TitleSection({ open }) {
  return (
    <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-3">
      <span className="grid h-9 w-11 shrink-0 place-content-center">
        <FileText className="h-5 w-5 text-ring" aria-hidden="true" />
      </span>
      {open && (
        <motion.div {...labelMotion} className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5 tracking-tight">
            <span className="text-base font-semibold text-primary-foreground">QMS</span>
            <span className="text-xs font-medium text-white/50">Query Management</span>
          </div>
        </motion.div>
      )}
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
  const handleLogout = () => {
    logout();
    navigate(ROUTE_PATHS.LOGIN);
  };

  return (
    <div className="border-t border-white/10 p-2">
      <div className="flex items-center gap-2">
        <span
          title={user.name}
          className="grid h-9 w-9 shrink-0 place-content-center rounded-full border border-white/15 bg-white/10 text-xs font-semibold text-primary-foreground select-none"
        >
          {initials(user.name)}
        </span>
        {open && (
          <>
            <motion.div {...labelMotion} className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium text-primary-foreground">{user.name}</div>
              {user.email && <div className="truncate text-xs text-white/50">{user.email}</div>}
              <div className="truncate text-xs text-white/50">{ROLE_LABELS[user.role]}</div>
            </motion.div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleLogout}
              aria-label="Sign out"
              className="shrink-0 text-white/60 hover:bg-white/10 hover:text-primary-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ToggleClose({ open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
      className="flex h-11 shrink-0 items-center border-t border-white/10 text-white/60 transition-colors hover:bg-white/5 hover:text-primary-foreground"
    >
      <span className="grid h-full w-11 shrink-0 place-content-center">
        <ChevronsRight
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </span>
      {open && (
        <motion.span {...labelMotion} className="text-sm font-medium">
          Collapse
        </motion.span>
      )}
    </button>
  );
}
