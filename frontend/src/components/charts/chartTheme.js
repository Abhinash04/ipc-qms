import { useMemo } from "react";
import { useAppliedThemeKey } from "@/components/theme/themeRuntime";
import { CHART_SERIES } from "@/constants/chartPalette";

export const SERIES_CSS = ["var(--color-primary)", "var(--color-info)", ...CHART_SERIES.slice(1)];

const FALLBACK = {
  primary: "#3a57e8",
  info: "#08b1ba",
  success: "#1aa053",
  warning: "#f16a1b",
  danger: "#c03221",
  ink: "#232d42",
  muted: "#8a92a6",
  line: "#e9ecef",
  surface: "#ffffff",
};

function readToken(styles, name, fallback) {
  const value = styles?.getPropertyValue(name)?.trim();
  return value && value.startsWith("#") ? value : fallback;
}

export function useChartTheme() {
  const key = useAppliedThemeKey();

  return useMemo(() => {
    const [mode, preset] = key.split("|");
    let styles;
    try {
      styles = getComputedStyle(document.documentElement);
    } catch {
      styles = null;
    }
    const tokens = {
      primary: readToken(styles, "--color-primary-500", FALLBACK.primary),
      info: readToken(styles, "--color-info", FALLBACK.info),
      success: readToken(styles, "--color-success", FALLBACK.success),
      warning: readToken(styles, "--color-warning", FALLBACK.warning),
      danger: readToken(styles, "--color-danger", FALLBACK.danger),
      ink: readToken(styles, "--color-ink", FALLBACK.ink),
      muted: readToken(styles, "--color-ink-muted", FALLBACK.muted),
      line: readToken(styles, "--color-line", FALLBACK.line),
      surface: readToken(styles, "--color-surface", FALLBACK.surface),
    };
    return {
      mode,
      preset,
      ...tokens,
      series: [tokens.primary, tokens.info, ...CHART_SERIES.slice(1)],
    };
  }, [key]);
}

export function baseOptions(theme) {
  return {
    chart: {
      background: "transparent",
      foreColor: theme.muted,
      fontFamily: "Inter, system-ui, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      animations: { enabled: true, speed: 500 },
    },
    theme: { mode: theme.mode },
    grid: {
      borderColor: theme.line,
      strokeDashArray: 4,
      padding: { left: 8, right: 8, top: -8 },
    },
    dataLabels: { enabled: false },
    legend: {
      labels: { colors: theme.muted },
      fontSize: "12px",
      markers: { size: 5 },
    },
    tooltip: { theme: theme.mode },
    states: { active: { filter: { type: "none" } } },
  };
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function mergeOptions(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = isObject(value) && isObject(base[key]) ? mergeOptions(base[key], value) : value;
  }
  return out;
}
