const valid = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDate(iso) {
  const date = valid(iso);
  return date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function formatTime(iso) {
  const date = valid(iso);
  return date ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
}

export function formatDateTime(iso) {
  return valid(iso) ? `${formatDate(iso)}, ${formatTime(iso)}` : '—';
}
