import { NavLink, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { navItemsForRole } from "@/constants/navigation";
import { SECTION } from "@/constants/routeSections";
import { ROUTE_PATHS } from "@/constants/routePaths";
import { useAuthStore } from "@/store/useAuthStore";
import { cn } from "@/utils/cn";

export function MobileNav() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  
  const items = navItemsForRole(currentUser?.role).filter(
    (item) => item.section !== SECTION.NOTIFICATIONS,
  );

  if (items.length === 0) return null;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-white/90 backdrop-blur-xl border-t border-slate-200/50 pb-safe shadow-[0_-4px_24px_rgba(0,0,0,0.06)] px-2 py-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.path}
            end={item.path === "/" || item.path.endsWith("/dashboard")}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 min-w-[64px] py-1.5 px-2 rounded-xl transition-all cursor-pointer",
                isActive
                  ? "text-blue-600 bg-blue-50/80"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform",
                    isActive ? "scale-110" : "",
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="text-[10px] font-bold leading-none tracking-tight">
                  {item.label}
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
        className="flex flex-col items-center justify-center gap-1 min-w-[64px] py-1.5 px-2 rounded-xl transition-all cursor-pointer text-slate-500 hover:text-rose-600 hover:bg-rose-50"
      >
        <LogOut className="h-5 w-5 transition-transform" strokeWidth={2} />
        <span className="text-[10px] font-bold leading-none tracking-tight">
          Sign out
        </span>
      </button>
    </div>
  );
}
