import { useCallback, useSyncExternalStore } from "react";

export const SIDEBAR_STORAGE_KEY = "qms.sidebar.collapsed";
const CHANGE_EVENT = "qms:sidebar-collapsed";

let memory = null;

export function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeCollapsed(value) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value));
  } catch {
    // storage blocked: the in-memory value below still drives the sidebar
  }
  memory = value;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot() {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw !== null) return raw === "true";
  } catch {
    // storage blocked: fall back to the in-memory value
  }
  return memory === true;
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => false);
  const setCollapsed = useCallback((value) => writeCollapsed(value), []);
  return [collapsed, setCollapsed];
}
