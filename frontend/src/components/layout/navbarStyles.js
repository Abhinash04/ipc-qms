export const NAV_ICON_BUTTON =
  "relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary-50 hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

export function initials(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"
  );
}
