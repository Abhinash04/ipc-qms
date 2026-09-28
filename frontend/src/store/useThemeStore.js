import { create } from "zustand";

export const THEME_STORAGE_KEY = "qms.theme";

export const THEME_OPTIONS = {
  mode: ["auto", "light", "dark"],
  preset: ["hope", "indigo", "teal", "violet", "amber"],
  sidebarColor: ["default", "dark", "color", "transparent"],
  sidebarActive: ["rounded-one", "rounded-all", "pill-one", "pill-all"],
  navbarStyle: ["default", "sticky", "glass"],
  dir: ["ltr", "rtl"],
  lang: ["en", "hi"],
};

export const THEME_DEFAULTS = {
  mode: "light",
  preset: "hope",
  sidebarColor: "default",
  sidebarActive: "rounded-all",
  sidebarHover: false,
  sidebarBoxed: false,
  navbarStyle: "sticky",
  dir: "ltr",
  lang: "en",
};

const KEYS = Object.keys(THEME_DEFAULTS);

function valid(key, value) {
  const allowed = THEME_OPTIONS[key];
  if (allowed) return allowed.includes(value);
  return typeof value === typeof THEME_DEFAULTS[key];
}

/** Saved settings, keeping only known keys with valid values. */
export function readSavedTheme() {
  const out = { ...THEME_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "{}");
    // Accept the zustand-persist envelope ({ state }) as well as a flat object.
    const state = saved && typeof saved === "object" && saved.state ? saved.state : saved;
    for (const key of KEYS) {
      if (state && key in state && valid(key, state[key])) out[key] = state[key];
    }
  } catch {
    /* unreadable or blocked storage: defaults */
  }
  return out;
}

function writeSavedTheme(state) {
  try {
    const picked = Object.fromEntries(KEYS.map((k) => [k, state[k]]));
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: picked, version: 1 }));
  } catch {
    /* storage blocked: the theme still applies for this session */
  }
}

export const useThemeStore = create((set) => ({
  ...readSavedTheme(),
  setOption: (key, value) => {
    if (!(key in THEME_DEFAULTS) || !valid(key, value)) return;
    set({ [key]: value });
  },
  reset: () => set({ ...THEME_DEFAULTS }),
}));

useThemeStore.subscribe(writeSavedTheme);

export function prefersDark() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
  } catch {
    return false;
  }
}

export function resolveMode(mode) {
  if (mode === "auto") return prefersDark() ? "dark" : "light";
  return mode === "dark" ? "dark" : "light";
}
