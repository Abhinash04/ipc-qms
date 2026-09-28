import { useCallback } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { STRINGS } from "@/i18n/strings";

export function translate(lang, key, fallback) {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? fallback ?? key;
}

export function useT() {
  const lang = useThemeStore((state) => state.lang);
  return useCallback((key, fallback) => translate(lang, key, fallback), [lang]);
}
