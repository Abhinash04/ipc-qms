import { useState } from "react";
import { Menu, Moon, RotateCcwIcon, Search, Settings, Sun } from "lucide-react";

import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useResolvedMode } from "@/components/theme/themeRuntime";
import { ROLES } from "@/constants/roles";
import { useT } from "@/i18n/useT";
import { cn } from "@/utils/cn";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SidebarContent } from "@/components/layout/Sidebar";
import { ThemeCustomizer } from "@/components/theme/ThemeCustomizer";
import { NAV_ICON_BUTTON } from "@/components/layout/navbarStyles";

const NAVBAR_STYLE = {
  default: "relative bg-surface border-b border-line",
  sticky: "sticky top-0 bg-surface shadow-card",
  glass:
    "sticky top-0 bg-(--navbar-glass) backdrop-blur-lg backdrop-saturate-150 border-b border-line/60",
};

export function Header() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const resetDemo = useWorkflowStore((state) => state.resetDemo);
  const persistenceError = useWorkflowStore((state) => state.persistenceError);
  const navbarStyle = useThemeStore((state) => state.navbarStyle);
  const lang = useThemeStore((state) => state.lang);
  const dir = useThemeStore((state) => state.dir);
  const setOption = useThemeStore((state) => state.setOption);
  const resolved = useResolvedMode();
  const t = useT();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isDark = resolved === "dark";

  return (
    <header
      className={cn(
        "z-30 flex h-18 shrink-0 items-center gap-2 px-4 sm:gap-3 lg:px-7",
        NAVBAR_STYLE[navbarStyle] || NAVBAR_STYLE.sticky,
      )}
    >
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className={cn(NAV_ICON_BUTTON, "lg:hidden")}
        aria-label={t("navbar.menu")}
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden shrink-0 items-center gap-3 xl:flex">
        <img
          src="/imageFile1.png"
          alt="IPC Emblem Logo"
          width="103"
          height="199"
          className="h-11 w-auto object-contain"
        />
        <div className="leading-tight">
          <div className="text-[11px] font-semibold text-ink-soft">भारतीय भेषज संहिता आयोग</div>
          <div className="text-[11.5px] font-bold uppercase tracking-tight text-ink">
            Indian Pharmacopoeia Commission
          </div>
        </div>
        <span className="ms-2 h-8 w-px bg-line" aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search queries and pages"
        aria-keyshortcuts="Control+K"
        className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface-muted px-3 text-start text-[13px] text-ink-muted transition-colors hover:border-primary-300 sm:max-w-xs md:max-w-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden truncate sm:inline">{t("navbar.search")}</span>
        <kbd className="ms-auto hidden rounded border border-line bg-surface px-1.5 text-[10.5px] font-medium sm:block">
          Ctrl K
        </kbd>
      </button>

      {persistenceError && (
        <span
          className="hidden shrink-0 items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11.5px] font-semibold text-red-700 xl:inline-flex"
          title={persistenceError}
        >
          Storage unavailable
        </span>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
        <button
          type="button"
          onClick={() => setOption("lang", lang === "en" ? "hi" : "en")}
          className={cn(NAV_ICON_BUTTON, "w-auto px-2.5 text-[12.5px] font-bold")}
          title={t("navbar.language")}
          aria-label={`${t("navbar.language")}: ${lang === "en" ? "English" : "हिन्दी"}`}
        >
          {lang === "en" ? "EN" : "हिं"}
        </button>

        <button
          type="button"
          onClick={() => setOption("mode", isDark ? "light" : "dark")}
          className={NAV_ICON_BUTTON}
          aria-label={t("navbar.theme")}
          aria-pressed={isDark}
          title={t("navbar.theme")}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <NotificationBell />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn(NAV_ICON_BUTTON, "hidden sm:flex")}
          aria-label={t("navbar.settings")}
          title={t("navbar.settings")}
        >
          <Settings className="h-5 w-5 motion-safe:animate-[spin_6s_linear_infinite]" />
        </button>

        {currentUser?.role === ROLES.SUPER_ADMIN && (
          <button
            type="button"
            onClick={resetDemo}
            className="hidden h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:border-danger hover:text-danger sm:flex"
            title="Reset database to initial state"
          >
            <RotateCcwIcon className="h-4 w-4" />
            <span className="hidden md:inline">Reset</span>
          </button>
        )}

        <span className="mx-1 hidden h-8 w-px bg-line sm:block" aria-hidden="true" />

        <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ThemeCustomizer open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side={dir === "rtl" ? "right" : "left"}
          showCloseButton={false}
          className="w-72 max-w-[85vw] border-side-border bg-side-bg p-0 text-side-fg"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Sections available to your role</SheetDescription>
          <SidebarContent open onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
