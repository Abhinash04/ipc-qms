const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Audit filters as the server wants them. A date picked in the browser means that whole day in
 * the viewer's time zone, so "from" becomes local midnight and "to" the last millisecond of the
 * day, both as UTC instants. A full timestamp (from a link) is passed through unchanged.
 */
export function toServerRange(filters) {
  const out = { ...filters };
  if (BARE_DATE.test(filters.from || '')) out.from = new Date(`${filters.from}T00:00:00`).toISOString();
  if (BARE_DATE.test(filters.to || '')) out.to = new Date(`${filters.to}T23:59:59.999`).toISOString();
  return out;
}
