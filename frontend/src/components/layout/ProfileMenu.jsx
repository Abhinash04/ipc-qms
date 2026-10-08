import { useNavigate } from "react-router-dom";
import { Bell, BarChart3, ChevronDown, LogOut, Palette } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sectionPath, ROUTE_PATHS } from "@/constants/routePaths";
import { SECTION } from "@/constants/routeSections";
import { sectionsForRole } from "@/constants/permissions";
import { ROLE_LABELS } from "@/constants/roles";
import { useAuthStore } from "@/store/useAuthStore";
import { useT } from "@/i18n/useT";
import { initials } from "@/components/layout/navbarStyles";

const ITEM = "cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-soft focus:bg-primary-50 focus:text-primary";

export function ProfileMenu({ onOpenSettings }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const t = useT();

  const role = currentUser?.role;
  const granted = new Set(role ? sectionsForRole(role) : []);
  const roleLabel = ROLE_LABELS[role];

  const signOut = () => {
    logout();
    navigate(ROUTE_PATHS.LOGIN);
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Signed in as ${currentUser?.name}, ${roleLabel}`}
          className="flex cursor-pointer items-center gap-3 rounded-full py-1 ps-1 pe-2 text-start transition-colors hover:bg-primary-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[13px] font-bold text-primary">
            {initials(currentUser?.name)}
          </span>
          <span className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className="truncate text-[14px] font-semibold text-ink">
              {currentUser?.name}
            </span>
            <span className="sr-only">— {roleLabel}</span>
            <span aria-hidden="true" className="truncate text-[12px] text-ink-muted">
              {roleLabel}
            </span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-ink-muted md:block" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-60 rounded-xl border-line bg-surface p-1.5 shadow-2xl"
      >
        <DropdownMenuLabel className="px-3 py-2">
          <div className="text-[13px] font-semibold text-ink">{currentUser?.name}</div>
          <div className="text-[11.5px] font-normal text-ink-muted">
            {currentUser?.email || roleLabel}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-line" />
        {granted.has(SECTION.NOTIFICATIONS) && (
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => navigate(sectionPath(role, SECTION.NOTIFICATIONS))}
          >
            <Bell className="h-4 w-4" />
            {t("navbar.notifications")}
          </DropdownMenuItem>
        )}
        {granted.has(SECTION.REPORTS) && (
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => navigate(sectionPath(role, SECTION.REPORTS))}
          >
            <BarChart3 className="h-4 w-4" />
            {t("navbar.reports")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM} onSelect={onOpenSettings}>
          <Palette className="h-4 w-4" />
          {t("navbar.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-line" />
        <DropdownMenuItem
          className={`${ITEM} text-danger focus:bg-danger/10 focus:text-danger`}
          onSelect={signOut}
        >
          <LogOut className="h-4 w-4 rtl:rotate-180" />
          {t("navbar.signout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
