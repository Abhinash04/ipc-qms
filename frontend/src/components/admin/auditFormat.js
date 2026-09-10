/**
 * Formatting helpers for audit records.
 *
 * Separate from AuditTable.jsx because a file that exports components must
 * export only components for fast refresh to work.
 */

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * `4m ago` / `Yesterday` / `12 Mar`.
 *
 * The activity feed is unbounded, so a bare clock time becomes ambiguous as
 * soon as an event is more than a day old. Callers pair this with the full
 * timestamp in a `title`, so precision is never actually lost.
 */
export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return 'Just now';
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** `EMAIL_SEND_FAILED` → `Email send failed`. */
export const humaniseAction = (action) =>
  String(action || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
