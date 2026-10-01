import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { applyTheme } from "@/components/theme/themeRuntime";

export function ThemeApplier() {
  const state = useThemeStore();

  useEffect(() => {
    applyTheme(state);
  }, [state]);

  return null;
}
