import { AUDIT_EVENT, BUSINESS_STATUS } from '@/constants/statusEnums';

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

export function yesterdayWindow() {
  return {
    from: startOfDay(-1).toISOString(),
    to: startOfDay(0).toISOString(),
  };
}

export function windowStart(days) {
  return days == null ? null : startOfDay(-days + 1).toISOString();
}

export function periodDelta(current = 0, previous = 0) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;

  if (now === before) return { text: 'No change', direction: 'flat', percent: 0 };
  if (before === 0) return { text: 'New activity', direction: 'up', percent: null };

  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) {
    return { text: '<1% change', direction: now > before ? 'up' : 'down', percent: 0 };
  }

  return {
    text: `${percent > 0 ? '+' : ''}${percent}%`,
    direction: percent > 0 ? 'up' : 'down',
    percent,
  };
}

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
    const bucket = index.get(dayKey(query.createdAt));
    if (bucket) bucket.value += 1;
  }
  return days;
}

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

export function processingFunnel(auditEvents = []) {
  return FUNNEL_STAGES.map(({ label, event }) => ({
    label,
    value: new Set(
      auditEvents.filter((e) => e.event === event && e.queryId).map((e) => e.queryId),
    ).size,
  }));
}
