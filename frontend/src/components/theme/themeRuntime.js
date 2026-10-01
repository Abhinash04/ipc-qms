import { useSyncExternalStore } from "react";

function subscribeToRootAttributes(callback) {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-preset"],
  });
  return () => observer.disconnect();
}

function rootThemeKey() {
  return document.documentElement.dataset.preset || "hope";
}

export function useAppliedThemeKey() {
  return useSyncExternalStore(subscribeToRootAttributes, rootThemeKey, () => "hope");
}

export function applyTheme(state) {
  const root = document.documentElement;
  root.dataset.preset = state.preset;
  root.dataset.sidebarColor = state.sidebarColor;
  root.dataset.sidebarActive = state.sidebarActive;
  root.dataset.navbar = state.navbarStyle;
  root.dir = state.dir;
  root.lang = state.lang;
}
