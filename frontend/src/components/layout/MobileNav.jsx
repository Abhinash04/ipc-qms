import { NavLink, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { navItemsForRole } from "@/constants/navigation";
import { ROUTE_PATHS } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";

export function MobileNav() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const t = useT();

  const items = navItemsForRole(currentUser?.role);

  if (items.length === 0) return null;

  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-line bg-surface/95 px-2 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.path}
            end={item.path === "/" || item.path.endsWith("/dashboard")}
            className={({ isActive }) =>
              cn(
                "flex min-w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
                isActive
                  ? "bg-primary-50 text-primary"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn("h-5 w-5 transition-transform", isActive && "scale-110")}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="text-[10px] font-semibold leading-none tracking-tight">
                  {t(`nav.${item.section}`, item.label)}
                </span>
              </>
            )}
          </NavLink>
        );
      })}

      <button
        type="button"
        onClick={() => {
          logout();
          navigate(ROUTE_PATHS.LOGIN);
        }}
        className="flex min-w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <LogOut className="h-5 w-5 rtl:rotate-180" strokeWidth={2} />
        <span className="text-[10px] font-semibold leading-none tracking-tight">
          {t("navbar.signout")}
        </span>
      </button>
    </div>
  );
}
