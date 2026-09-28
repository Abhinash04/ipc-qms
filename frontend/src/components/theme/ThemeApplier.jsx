import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { applyTheme, useResolvedMode } from "@/components/theme/themeRuntime";

export function ThemeApplier() {
  const state = useThemeStore();
  const resolved = useResolvedMode();

  useEffect(() => {
    applyTheme(state, resolved);
  }, [state, resolved]);

  return null;
}
