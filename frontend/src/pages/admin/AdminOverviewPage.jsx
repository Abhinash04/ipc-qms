import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Bot,
  Database,
  Mail,
  ShieldCheck,
  ArrowRight,
  ChevronRight,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
} from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDonut, TrendLine, ProcessingFunnel } from '@/components/admin/charts';
import { Panel, PanelHeader, PANEL_CLASS } from '@/components/admin/Panel';
import { KpiTile } from '@/components/admin/KpiTile';
import { actionVisual } from '@/components/admin/actionIcons';
import { formatTime, relativeTime, humaniseAction } from '@/components/admin/auditFormat';
import {
  sumBy,
  isEmailAction,
  isAiAction,
  periodDelta,
  statusDistribution,
  volumeByDay,
  processingFunnel,
  caseTrend,
  yesterdayWindow,
  windowStart,
} from '@/components/admin/adminStats';
import { fetchAuditSummary, fetchAuditEvents } from '@/services/api/adminService';
import { fetchEmailConfig } from '@/services/api/mailboxService';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { SECTION, SECTIONS } from '@/constants/routeSections';
import { cn } from '@/utils/cn';

/**
 * The Administration overview.
 *
 * Two data sources, deliberately distinguished on screen rather than blended:
 *
 *  - **Server-recorded** (audit trail): email, AI, attachment and access
 *    events. Real persisted records, true across every user.
 *  - **This browser** (workflow store): case counts and the case lifecycle.
 *    Real user-generated data, but Query Cases are not yet persisted
 *    server-side, so these numbers describe this device only.
 *
 * Nothing here is seeded, sampled or estimated. Where there is no data, the
 * section says so instead of showing a zero dressed up as a measurement.
 *
 * The period-over-period figures are real too: `GET /audit/summary` passes a
 * caller's `from`/`to` through to its `overall` half, so "vs yesterday" is a
 * second windowed request against the audit collection, not arithmetic on a
 * number invented in the browser.
 */

const ACTOR_LABELS = { human: 'User', agent: 'AI Agent', system: 'System' };

const RANGES = [
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '1', label: 'Today', days: 1 },
  { value: 'all', label: 'All time', days: null },
];

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus };

const AREA_SECTIONS = [
  SECTION.ADMIN_ACTIVITY,
  SECTION.ADMIN_EMAIL,
  SECTION.ADMIN_AI,
  SECTION.USERS,
  SECTION.ROLES_DIRECTORY,
  SECTION.DIVISIONS,
  SECTION.ADMIN_SETTINGS,
];

const AREA_TINTS = {
  [SECTION.ADMIN_ACTIVITY]: 'bg-blue-100 text-blue-700',
  [SECTION.ADMIN_EMAIL]: 'bg-emerald-100 text-emerald-700',
  [SECTION.ADMIN_AI]: 'bg-violet-100 text-violet-700',
  [SECTION.USERS]: 'bg-sky-100 text-sky-700',
  [SECTION.ROLES_DIRECTORY]: 'bg-indigo-100 text-indigo-700',
  [SECTION.DIVISIONS]: 'bg-amber-100 text-amber-700',
  [SECTION.ADMIN_SETTINGS]: 'bg-slate-200 text-slate-700',
};

function SourceNote({ children }) {
  return <p className="m-0 mt-2 text-[11px] font-semibold text-slate-400">{children}</p>;
}

/** One figure beneath the case trend line. */
function MiniStat({ icon: Icon, value, label, tone = 'text-slate-400' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50', tone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-heading text-[19px] font-black leading-none tabular-nums text-slate-900">
          {value}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{label}</span>
      </span>
    </div>
  );
}

export function AdminOverviewPage() {
  const paths = useRoutePaths();
  const queries = useWorkflowStore((state) => state.queries);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);
  const [range, setRange] = useState('7');

  const summary = useQuery({
    queryKey: ['audit', 'summary'],
    queryFn: () => fetchAuditSummary(),
    retry: false,
  });

  // The comparison window. A separate request rather than a derived guess —
  // if this call is missing, the tiles cannot show a trend at all.
  const previous = useQuery({
    queryKey: ['audit', 'summary', 'yesterday'],
    queryFn: () => fetchAuditSummary(yesterdayWindow()),
    retry: false,
  });

  const selectedRange = RANGES.find((r) => r.value === range) || RANGES[0];
  const actors = useQuery({
    queryKey: ['audit', 'summary', 'actors', range],
    queryFn: () => {
      const from = windowStart(selectedRange.days);
      return fetchAuditSummary(from ? { from } : {});
    },
    retry: false,
  });

  const recent = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => fetchAuditEvents({ limit: 8 }),
    retry: false,
  });

  const emailConfig = useQuery({
    queryKey: ['emailConfig'],
    queryFn: fetchEmailConfig,
    retry: false,
  });

  const today = summary.data?.today;
  const overall = summary.data?.overall;
  // `overall` on a windowed request is that window's count — see the file note.
  const yesterday = previous.data?.overall;
  const actorCounts = actors.data?.overall?.byActorType;

  const failuresOf = (period) =>
    (period?.byResult?.failure ?? 0) + (period?.byResult?.denied ?? 0);

  // A delta is only offered once the comparison window has actually loaded.
  const deltaFor = (current, prior) =>
    previous.isSuccess ? periodDelta(current, prior) : null;

  const tiles = [
    {
      label: 'System events today',
      value: today?.total ?? 0,
      icon: Activity,
      to: paths[SECTION.ADMIN_ACTIVITY],
      delta: deltaFor(today?.total ?? 0, yesterday?.total ?? 0),
      tint: 'bg-blue-100 text-blue-700',
      surface: 'bg-blue-50/50',
      border: 'border-blue-200/70',
    },
    {
      label: 'Email actions today',
      value: sumBy(today?.byAction, isEmailAction),
      icon: Mail,
      to: paths[SECTION.ADMIN_EMAIL],
      delta: deltaFor(sumBy(today?.byAction, isEmailAction), sumBy(yesterday?.byAction, isEmailAction)),
      tint: 'bg-emerald-100 text-emerald-700',
      surface: 'bg-emerald-50/50',
      border: 'border-emerald-200/70',
    },
    {
      label: 'AI generations today',
      value: sumBy(today?.byAction, isAiAction),
      icon: Bot,
      to: paths[SECTION.ADMIN_AI],
      delta: deltaFor(sumBy(today?.byAction, isAiAction), sumBy(yesterday?.byAction, isAiAction)),
      tint: 'bg-violet-100 text-violet-700',
      surface: 'bg-violet-50/50',
      border: 'border-violet-200/70',
    },
    {
      label: 'Failures & denials today',
      value: failuresOf(today),
      icon: AlertTriangle,
      to: paths[SECTION.ADMIN_ACTIVITY] && `${paths[SECTION.ADMIN_ACTIVITY]}?result=failure`,
      delta: deltaFor(failuresOf(today), failuresOf(yesterday)),
      tint: 'bg-rose-100 text-rose-700',
      surface: 'bg-rose-50/50',
      border: 'border-rose-200/70',
      // The one metric where a rise is bad news, so the trend must not be green.
      higherIsWorse: true,
    },
  ];

  const byStatus = statusDistribution(queries);
  const funnel = processingFunnel(auditEvents);
  const caseVolume = volumeByDay(queries);
  const trend = caseTrend(queries);
  const TrendIcon = TREND_ICON[trend.delta.direction] || Minus;

  const supportAddress = emailConfig.data?.ipcQueryEmail;

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Administration' }]} />
      <PageHeader
        title="Administration"
        purpose="What is happening in the QMS right now, and what has happened so far."
      />

      {summary.isError && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
          <p className="m-0 font-bold">System activity unavailable</p>
          <p className="m-0 mt-0.5 text-[13px]">
            The audit API could not be reached, so the server-recorded figures below are not shown. Case
            counts come from this browser and are unaffected.
          </p>
        </div>
      )}

      {/* ── Server-recorded KPIs ──────────────────────────────────────────── */}
      <section aria-labelledby="server-activity">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="server-activity" className="font-heading text-[17px] font-black text-slate-900">
            System activity
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            Recorded server-side · {overall?.total ?? 0} in total
            {overall && !overall.durable && (
              <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                in-memory — not durable
              </span>
            )}
          </span>
        </div>

        {summary.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((tile) => (
              <KpiTile key={tile.label} {...tile} />
            ))}
          </div>
        )}
      </section>

      {/* ── Activity feed + actor breakdown ───────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Panel aria-labelledby="recent-activity" className="flex flex-col">
          <PanelHeader
            id="recent-activity"
            title="Recent system activity"
            action={
              paths[SECTION.ADMIN_ACTIVITY] && (
                <Link
                  to={paths[SECTION.ADMIN_ACTIVITY]}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg text-[12.5px] font-bold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )
            }
          />

          {recent.isLoading && <Skeleton className="h-64 w-full rounded-2xl" />}
          {recent.isError && (
            <p className="text-[13px] text-slate-500">The audit API could not be reached.</p>
          )}
          {recent.data && recent.data.events.length === 0 && (
            <EmptyState
              icon={Activity}
              title="No system activity yet"
              description="Send an email, run an AI draft or upload an attachment and it will appear here."
            />
          )}
          {recent.data && recent.data.events.length > 0 && (
            <ol className="m-0 list-none divide-y divide-slate-100 p-0">
              {recent.data.events.map((event, index) => {
                const { icon: EventIcon, tint } = actionVisual(event.action);
                const target = event.queryId || event.actorRole || event.actorType;

                return (
                  <li
                    key={`${event.timestamp}-${index}`}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <time
                      dateTime={event.timestamp}
                      title={formatTime(event.timestamp)}
                      className="w-16 shrink-0 text-[11px] font-bold tabular-nums text-slate-400"
                    >
                      {relativeTime(event.timestamp)}
                    </time>

                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        tint,
                      )}
                    >
                      <EventIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>

                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800">
                      {humaniseAction(event.action)}
                    </span>

                    <span
                      className="hidden min-w-0 max-w-40 shrink truncate text-[11.5px] font-semibold text-slate-400 sm:block"
                      title={target || undefined}
                    >
                      {target}
                    </span>

                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold capitalize',
                        event.result === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : event.result === 'denied'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-rose-200 bg-rose-50 text-rose-700',
                      )}
                    >
                      {event.result}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel aria-labelledby="who-is-acting">
          <PanelHeader
            id="who-is-acting"
            title="System activity by actor"
            action={
              <div className="shrink-0">
                <label htmlFor="actor-range" className="sr-only">
                  Time range for activity by actor
                </label>
                <select
                  id="actor-range"
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          {actors.isLoading ? (
            <Skeleton className="h-44 w-full rounded-2xl" />
          ) : actors.isError ? (
            <p className="text-[13px] text-slate-500">The audit API could not be reached.</p>
          ) : (
            <StatusDonut
              title={selectedRange.label}
              emptyText="No events recorded in this period"
              data={Object.entries(actorCounts || {}).map(([key, value]) => ({
                label: ACTOR_LABELS[key] || 'Other',
                value,
              }))}
            />
          )}
          <SourceNote>Server-recorded. Counts every audited action.</SourceNote>
        </Panel>
      </div>

      {/* ── This browser ──────────────────────────────────────────────────── */}
      <section aria-labelledby="case-activity">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="case-activity" className="font-heading text-[17px] font-black text-slate-900">
            Query cases overview
          </h2>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">
            This browser only — cases are not yet stored server-side
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel>
            <StatusDonut title="Status distribution" data={byStatus} emptyText="No cases in this browser yet" />
          </Panel>

          <Panel className="flex flex-col">
            <TrendLine
              title="Cases created — last 7 days"
              data={caseVolume}
              emptyText="No cases created in the last 7 days"
            />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <MiniStat icon={CalendarDays} value={trend.current} label="Total created" />
              <MiniStat
                icon={TrendIcon}
                value={trend.delta.text}
                label="vs previous 7 days"
                tone={
                  trend.delta.direction === 'up'
                    ? 'text-emerald-600'
                    : trend.delta.direction === 'down'
                      ? 'text-rose-600'
                      : 'text-slate-400'
                }
              />
            </div>
          </Panel>

          <Panel>
            <ProcessingFunnel
              title="Processing funnel"
              stages={funnel}
              emptyText="No lifecycle events recorded yet"
            />
          </Panel>
        </div>
      </section>

      {/* ── Console areas ─────────────────────────────────────────────────── */}
      <section aria-labelledby="console-areas">
        <Panel>
          <PanelHeader
            id="console-areas"
            title="Administration areas"
            note="Manage all aspects of the QMS platform"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AREA_SECTIONS.filter((section) => paths[section]).map((section) => {
              const { label, icon: Icon, description } = SECTIONS[section];
              return (
                <Link
                  key={section}
                  to={paths[section]}
                  className={cn(
                    'group flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5',
                    'motion-safe:transition-all motion-reduce:transition-none',
                    'hover:border-blue-300 hover:shadow-md',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      AREA_TINTS[section] || 'bg-slate-100 text-slate-600',
                    )}
                  >
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-black text-slate-800">{label}</span>
                    {description && (
                      <span className="mt-0.5 block truncate text-[11.5px] font-semibold text-slate-400">
                        {description}
                      </span>
                    )}
                  </span>

                  {section === SECTION.ADMIN_SETTINGS && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-700">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      Elevated
                    </span>
                  )}

                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-blue-500"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}

            {/* Support routes to the configured IPC address rather than a
                help centre this deployment does not have. */}
            <div
              className={cn(
                PANEL_CLASS,
                'flex items-center gap-3 border-slate-200/80 px-4 py-3.5 shadow-none',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <HelpCircle className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-black text-slate-800">Need help?</span>
                <span className="mt-0.5 block truncate text-[11.5px] font-semibold text-slate-400">
                  {supportAddress
                    ? `Contact the QMS team at ${supportAddress}`
                    : 'Contact the QMS team'}
                </span>
              </span>
              {supportAddress && (
                <a
                  href={`mailto:${supportAddress}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Email us <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
