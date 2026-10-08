import { create } from "zustand";

export const THEME_STORAGE_KEY = "qms.theme";

export const THEME_OPTIONS = {
  preset: ["hope", "indigo", "teal", "violet", "amber"],
  sidebarColor: ["default", "dark", "color", "transparent"],
  sidebarActive: ["rounded-one", "rounded-all", "pill-one", "pill-all"],
  navbarStyle: ["default", "sticky", "glass"],
  dir: ["ltr", "rtl"],
  lang: ["en", "hi"],
};

export const THEME_DEFAULTS = {
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

export function readSavedTheme() {
  const out = { ...THEME_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "{}");
    const state = saved && typeof saved === "object" && saved.state ? saved.state : saved;
    for (const key of KEYS) {
      if (state && key in state && valid(key, state[key])) out[key] = state[key];
    }
  } catch {}
  return out;
}

function writeSavedTheme(state) {
  try {
    const picked = Object.fromEntries(KEYS.map((k) => [k, state[k]]));
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: picked, version: 1 }));
  } catch {}
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
