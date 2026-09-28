import { useSyncExternalStore } from "react";
import { resolveMode, useThemeStore } from "@/store/useThemeStore";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(callback) {
  const media = window.matchMedia?.(DARK_QUERY);
  if (!media?.addEventListener) return () => {};
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function useResolvedMode() {
  const mode = useThemeStore((state) => state.mode);
  return useSyncExternalStore(
    subscribeToScheme,
    () => resolveMode(mode),
    () => (mode === "dark" ? "dark" : "light"),
  );
}

function subscribeToRootAttributes(callback) {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-preset"],
  });
  return () => observer.disconnect();
}

function rootThemeKey() {
  const root = document.documentElement;
  return `${root.classList.contains("dark") ? "dark" : "light"}|${root.dataset.preset || "hope"}`;
}

export function useAppliedThemeKey() {
  return useSyncExternalStore(subscribeToRootAttributes, rootThemeKey, () => "light|hope");
}

export function applyTheme(state, resolved) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.preset = state.preset;
  root.dataset.sidebarColor = state.sidebarColor;
  root.dataset.sidebarActive = state.sidebarActive;
  root.dataset.navbar = state.navbarStyle;
  root.dir = state.dir;
  root.lang = state.lang;
}
