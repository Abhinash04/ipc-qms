import { AUDIT_EVENT, BUSINESS_STATUS } from '@/constants/statusEnums';

/**
 * The Administration overview's aggregations.
 *
 * Extracted from the page so they can be tested directly: a dashboard figure is
 * only trustworthy if the arithmetic behind it is pinned by a test, and a
 * function defined inside a component file cannot be imported by one.
 *
 * Every function here reads real records — server audit counts, or the local
 * workflow store. None of them invent, sample or estimate a value.
 */

/** Local-midnight day key, so bucketing matches the user's calendar, not UTC. */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

export const sumBy = (counts, predicate) =>
  Object.entries(counts || {}).reduce(
    (total, [key, n]) => (predicate(key) ? total + n : total),
    0,
  );

export const isEmailAction = (action) => action.startsWith('EMAIL_');
export const isAiAction = (action) => action.startsWith('AI_');

/**
 * The window the KPI tiles compare against: the whole of yesterday.
 *
 * Returned as ISO strings because that is what `GET /audit/summary` filters on
 * — its `overall` half passes the caller's `from`/`to` straight through, so
 * this yields a genuine server-side count rather than anything derived here.
 */
export function yesterdayWindow() {
  return {
    from: startOfDay(-1).toISOString(),
    to: startOfDay(0).toISOString(),
  };
}

/** ISO start of a rolling window, for the actor donut's period selector. */
export function windowStart(days) {
  return days == null ? null : startOfDay(-days + 1).toISOString();
}

/**
 * Period-over-period change.
 *
 * The zero cases are the point of this function. The audit store degrades to an
 * in-memory buffer when Mongo is unreachable, so "yesterday" can legitimately
 * be empty — and a naive percentage would then render an infinite or 100% jump
 * off a baseline that was never measured. Say what is actually known instead.
 */
export function periodDelta(current = 0, previous = 0) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;

  if (now === before) return { text: 'No change', direction: 'flat', percent: 0 };
  if (before === 0) return { text: 'New activity', direction: 'up', percent: null };

  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) {
    // A change too small to round to a percent is not "no change" — say so
    // without claiming a magnitude the rounding cannot support.
    return { text: '<1% change', direction: now > before ? 'up' : 'down', percent: 0 };
  }

  return {
    text: `${percent > 0 ? '+' : ''}${percent}%`,
    direction: percent > 0 ? 'up' : 'down',
    percent,
  };
}

/** Open / In progress / Closed, counted from real cases in this browser. */
export function statusDistribution(queries = []) {
  return [
    {
      label: 'Open',
      value: queries.filter((q) => q.businessStatus === BUSINESS_STATUS.OPEN).length,
    },
    {
      label: 'In progress',
      value: queries.filter((q) => q.businessStatus === BUSINESS_STATUS.IN_PROGRESS).length,
    },
    {
      label: 'Closed',
      value: queries.filter((q) => q.businessStatus === BUSINESS_STATUS.CLOSED).length,
    },
  ];
}

/** Last seven days, oldest first, counted from real case timestamps. */
export function volumeByDay(queries = []) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = startOfDay(-i);
    days.push({
      label: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      key: dayKey(day),
      value: 0,
    });
  }

  const index = new Map(days.map((d) => [d.key, d]));
  for (const query of queries) {
    // Both sides are keyed in local time. Slicing the raw ISO string here
    // instead would place a case created after local midnight but before the
    // UTC day rolls over into the wrong bucket.
    const bucket = index.get(dayKey(query.createdAt));
    if (bucket) bucket.value += 1;
  }
  return days;
}

/** Cases created in the last 7 days, against the 7 before that. */
export function caseTrend(queries = []) {
  const currentFrom = startOfDay(-6).getTime();
  const previousFrom = startOfDay(-13).getTime();

  let current = 0;
  let previous = 0;

  for (const query of queries) {
    const at = new Date(query.createdAt).getTime();
    if (Number.isNaN(at)) continue;
    if (at >= currentFrom) current += 1;
    else if (at >= previousFrom) previous += 1;
  }

  return { current, previous, delta: periodDelta(current, previous) };
}

const FUNNEL_STAGES = [
  { label: 'Queries received', event: AUDIT_EVENT.QUERY_RECEIVED },
  { label: 'Acknowledged', event: AUDIT_EVENT.ACKNOWLEDGEMENT_SENT },
  { label: 'Forwarded to OIC', event: AUDIT_EVENT.QUERY_FORWARDED },
  { label: 'Assigned', event: AUDIT_EVENT.QUERY_ASSIGNED },
  { label: 'Dispatched', event: AUDIT_EVENT.RESPONSE_DISPATCHED },
  { label: 'Closed', event: AUDIT_EVENT.QUERY_CLOSED },
];

/**
 * How far cases have travelled through the workflow.
 *
 * Counts *distinct cases* per stage, not raw events: QUERY_RECEIVED is also
 * emitted when follow-up correspondence attaches to an existing thread and when
 * a mailbox copy is claimed onto a portal case, so counting events would report
 * more enquiries received than there are enquiries.
 */
export function processingFunnel(auditEvents = []) {
  return FUNNEL_STAGES.map(({ label, event }) => ({
    label,
    value: new Set(
      auditEvents.filter((e) => e.event === event && e.queryId).map((e) => e.queryId),
    ).size,
  }));
}
