import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { m } from "framer-motion";
import { ChevronLeft, LogOut } from "lucide-react";

import { navGroupsForRole } from "@/constants/navigation";
import { SECTION } from "@/constants/routeSections";
import { ROUTE_PATHS } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useSidebarCollapsed } from "@/components/layout/sidebarState";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const WIDTH_OPEN = 260;

export const RAIL_ITEM = 44;
export const RAIL_PADDING = 16;
export const WIDTH_CLOSED = RAIL_ITEM + RAIL_PADDING * 2;

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0";

function RailTooltip({ open, label, children }) {
  if (open) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={14}
        className="bg-ink text-surface border-0 font-semibold text-xs shadow-card"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({ open, collapsed = !open, onNavigate, onToggle }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const t = useT();

  const groups = navGroupsForRole(currentUser?.role);

  const handleLogout = () => {
    logout();
    navigate(ROUTE_PATHS.LOGIN);
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <div
        className={cn(
          "relative flex h-18 shrink-0 items-center border-b border-side-border",
          open ? "ps-5 pe-4" : "justify-center px-2",
        )}
      >
        {open ? (
          <span className="brand-plate">
            <img
              src="/anuvadini_new_logo 2.png"
              alt="Anuvadini Logo"
              width="512"
              height="288"
              className="h-13 w-auto max-w-44 object-contain"
            />
          </span>
        ) : (
          <img
            src="/anuvadini-icon.png"
            alt="Anuvadini Icon"
            width="128"
            height="128"
            className="h-10 w-10 object-contain"
          />
        )}

        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "absolute top-1/2 -inset-e-3.5 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white shadow-md ring-4 ring-surface-muted transition-transform hover:scale-105 cursor-pointer",
              FOCUS_RING,
            )}
          >
            <ChevronLeft
              className={cn(
                "h-4 w-4 transition-transform duration-200 rtl:rotate-180",
                collapsed && "rotate-180 rtl:rotate-0",
              )}
            />
          </button>
        )}
      </div>

      <div className="relative flex-1 overflow-y-auto overflow-x-hidden py-4">
        <nav
          aria-label="Primary"
          className={cn(
            "flex flex-col",
            open ? "side-rail-open px-4" : "items-center px-4",
          )}
        >
          {groups.map(({ group, items }, index) => (
            <div key={group} className={cn("flex flex-col gap-1", index > 0 && "mt-4")}>
              {open ? (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-side-muted">
                  {t(`nav.group.${group}`)}
                </p>
              ) : (
                index > 0 && (
                  <span
                    aria-hidden="true"
                    className="mx-auto mb-2 block h-px w-6 bg-side-border"
                  />
                )
              )}
              {items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  open={open}
                  label={t(`nav.${item.section}`, item.label)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-side-border p-4",
          !open && "flex flex-col items-center",
        )}
      >
        {open && (
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-side-hover px-3 py-2.5">
            <img
              src="/imageFile1.png"
              alt=""
              width="103"
              height="199"
              className="h-9 w-auto shrink-0 object-contain"
            />
            <div className="min-w-0">
              <div className="truncate font-heading text-[13px] font-bold text-side-fg">
                BRIDGETECH
              </div>
              <div className="truncate text-[11px] text-side-muted">
                AI-powered IP Stakeholders’
              </div>
            </div>
          </div>
        )}
        <RailTooltip open={open} label="Sign out session">
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out session"
            className={cn(
              "side-link flex items-center justify-center gap-2 text-[13px] font-semibold transition-colors cursor-pointer hover:bg-danger/10 hover:text-danger",
              FOCUS_RING,
              open ? "w-full px-3 py-2.5" : "h-11 w-11",
            )}
          >
            <LogOut className="h-4.5 w-4.5 shrink-0 rtl:rotate-180" strokeWidth={2.2} />
            {open && <span>Sign out session</span>}
          </button>
        </RailTooltip>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const hoverMode = useThemeStore((state) => state.sidebarHover);
  const boxed = useThemeStore((state) => state.sidebarBoxed);
  const [hovering, setHovering] = useState(false);

  const expanded = !collapsed || (hoverMode && hovering);

  return (
    <TooltipProvider delayDuration={150}>
      <m.aside
        initial={false}
        animate={{ width: collapsed ? WIDTH_CLOSED : WIDTH_OPEN }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "hidden lg:block relative z-40 h-screen shrink-0 select-none",
          boxed && "py-4 ps-4",
        )}
        style={boxed ? { boxSizing: "content-box" } : undefined}
      >
        <m.div
          initial={false}
          animate={{ width: expanded ? WIDTH_OPEN : WIDTH_CLOSED }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className={cn(
            "absolute inset-y-0 inset-s-0 bg-side-bg text-side-fg",
            boxed
              ? "inset-y-4 inset-s-4 rounded-2xl shadow-card"
              : "border-e border-side-border shadow-[0_0_30px_rgba(17,38,146,0.05)]",
            hoverMode && collapsed && hovering && "shadow-2xl",
          )}
        >
          <SidebarContent
            open={expanded}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
          />
        </m.div>
      </m.aside>
    </TooltipProvider>
  );
}

function NavItem({ item, open, label, onNavigate }) {
  const { path, icon: Icon, section } = item;

  return (
    <RailTooltip open={open} label={label}>
      <NavLink
        to={path}
        end={section === SECTION.DASHBOARD}
        aria-label={label}
        onClick={onNavigate}
        className={cn(
          "side-link group relative flex items-center transition-colors duration-150",
          FOCUS_RING,
          open
            ? "gap-3 px-3 py-2.5 text-[14px] font-medium"
            : "h-11 w-11 justify-center",
        )}
      >
        <Icon
          className="h-5 w-5 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
        {open && <span className="flex-1 truncate leading-none">{label}</span>}
      </NavLink>
    </RailTooltip>
  );
}
