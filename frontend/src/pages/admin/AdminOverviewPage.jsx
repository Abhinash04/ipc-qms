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

import { DashboardHero } from '@/components/dashboard/DashboardHero';
import { useAuthStore } from '@/store/useAuthStore';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDonut, TrendLine, ProcessingFunnel } from '@/components/admin/charts';
import { Panel, PanelHeader, PANEL_CLASS } from '@/components/admin/Panel';
import { KpiTile } from '@/components/admin/KpiTile';
import { actionVisual } from '@/components/admin/actionIcons';
import { stableKey } from '@/utils/stableKey';
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
  [SECTION.ADMIN_ACTIVITY]: 'bg-primary-50 text-primary',
  [SECTION.ADMIN_EMAIL]: 'bg-emerald-50 text-emerald-600',
  [SECTION.ADMIN_AI]: 'bg-violet-50 text-violet-600',
  [SECTION.USERS]: 'bg-sky-50 text-sky-600',
  [SECTION.ROLES_DIRECTORY]: 'bg-primary-50 text-primary',
  [SECTION.DIVISIONS]: 'bg-amber-50 text-amber-600',
  [SECTION.ADMIN_SETTINGS]: 'bg-slate-100 text-slate-600',
};

function SourceNote({ children }) {
  return <p className="m-0 mt-3 text-[11.5px] text-ink-muted">{children}</p>;
}

function MiniStat({ icon: Icon, value, label, tone = 'text-ink-muted' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted', tone)}>
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-heading text-[20px] font-bold leading-none tabular-nums text-ink">
          {value}
        </span>
        <span className="mt-1 block truncate text-[11.5px] text-ink-muted">{label}</span>
      </span>
    </div>
  );
}

function resultBadgeClass(result) {
  if (result === 'success') return 'bg-emerald-50 text-emerald-700';
  if (result === 'denied') return 'bg-amber-50 text-amber-800';
  return 'bg-rose-50 text-rose-700';
}

function trendTone(direction) {
  if (direction === 'up') return 'text-emerald-600';
  if (direction === 'down') return 'text-rose-600';
  return 'text-ink-muted';
}

function useAdminActivity(range) {
  const summary = useQuery({
    queryKey: ['audit', 'summary'],
    queryFn: () => fetchAuditSummary(),
    retry: false,
  });

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

  return { summary, previous, actors, recent, emailConfig, selectedRange };
}

const failuresOf = (period) =>
  (period?.byResult?.failure ?? 0) + (period?.byResult?.denied ?? 0);

function buildKpiTiles({ today, yesterday, hasComparison, paths }) {
  const deltaFor = (current, prior) =>
    hasComparison ? periodDelta(current, prior) : null;

  return [
    {
      label: 'System events today',
      value: today?.total ?? 0,
      icon: Activity,
      to: paths[SECTION.ADMIN_ACTIVITY],
      delta: deltaFor(today?.total ?? 0, yesterday?.total ?? 0),
      tint: 'bg-primary-50 text-primary',
      accent: 'text-primary',
    },
    {
      label: 'Email actions today',
      value: sumBy(today?.byAction, isEmailAction),
      icon: Mail,
      to: paths[SECTION.ADMIN_EMAIL],
      delta: deltaFor(
        sumBy(today?.byAction, isEmailAction),
        sumBy(yesterday?.byAction, isEmailAction),
      ),
      tint: 'bg-emerald-50 text-emerald-600',
      accent: 'text-emerald-500',
    },
    {
      label: 'AI generations today',
      value: sumBy(today?.byAction, isAiAction),
      icon: Bot,
      to: paths[SECTION.ADMIN_AI],
      delta: deltaFor(
        sumBy(today?.byAction, isAiAction),
        sumBy(yesterday?.byAction, isAiAction),
      ),
      tint: 'bg-violet-50 text-violet-600',
      accent: 'text-violet-500',
    },
    {
      label: 'Failures & denials today',
      value: failuresOf(today),
      icon: AlertTriangle,
      to:
        paths[SECTION.ADMIN_ACTIVITY] &&
        `${paths[SECTION.ADMIN_ACTIVITY]}?result=failure`,
      delta: deltaFor(failuresOf(today), failuresOf(yesterday)),
      tint: 'bg-rose-50 text-rose-600',
      accent: 'text-rose-500',
      higherIsWorse: true,
    },
  ];
}

function SystemActivitySection({ summary, overall, tiles }) {
  return (
    <section aria-labelledby="server-activity" className="relative z-10 -mt-24">
      <h2 id="server-activity" className="sr-only">
        System activity
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-2xl" />
            ))
          : tiles.map((tile) => <KpiTile key={tile.label} {...tile} />)}
      </div>
      <p className="m-0 mt-3 inline-flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
        <Database className="h-3.5 w-3.5" aria-hidden="true" />
        System activity recorded server-side · {overall?.total ?? 0} in total
        {overall && !overall.durable && (
          <span className="ms-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
            in-memory — not durable
          </span>
        )}
      </p>
    </section>
  );
}

function ActivityRow({ event }) {
  const { icon: EventIcon, tint } = actionVisual(event.action);
  const target = event.queryId || event.actorRole || event.actorType;

  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <time
        dateTime={event.timestamp}
        title={formatTime(event.timestamp)}
        className="w-16 shrink-0 text-[11.5px] tabular-nums text-ink-muted"
      >
        {relativeTime(event.timestamp)}
      </time>

      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          tint,
        )}
      >
        <EventIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
        {humaniseAction(event.action)}
      </span>

      <span
        className="hidden min-w-0 max-w-40 shrink truncate text-[12px] text-ink-muted sm:block"
        title={target || undefined}
      >
        {target}
      </span>

      <span
        className={cn(
          'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize',
          resultBadgeClass(event.result),
        )}
      >
        {event.result}
      </span>
    </li>
  );
}

function RecentActivityBody({ recent }) {
  if (recent.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;

  if (recent.isError) {
    return <p className="text-[13px] text-ink-muted">The audit API could not be reached.</p>;
  }

  if (!recent.data) return null;

  if (recent.data.events.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No system activity yet"
        description="Send an email, run an AI draft or upload an attachment and it will appear here."
      />
    );
  }

  return (
    <ol className="m-0 list-none divide-y divide-line p-0">
      {recent.data.events.map((event) => (
        <ActivityRow key={event._id || stableKey(event)} event={event} />
      ))}
    </ol>
  );
}

function RecentActivityPanel({ recent, paths }) {
  return (
    <Panel aria-labelledby="recent-activity" className="flex flex-col">
      <PanelHeader
        id="recent-activity"
        title="Recent system activity"
        action={
          paths[SECTION.ADMIN_ACTIVITY] && (
            <Link
              to={paths[SECTION.ADMIN_ACTIVITY]}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )
        }
      />

      <RecentActivityBody recent={recent} />
    </Panel>
  );
}

function ActorBreakdownBody({ actors, selectedRange }) {
  if (actors.isLoading) return <Skeleton className="h-44 w-full rounded-2xl" />;

  if (actors.isError) {
    return <p className="text-[13px] text-ink-muted">The audit API could not be reached.</p>;
  }

  const actorCounts = actors.data?.overall?.byActorType;

  return (
    <StatusDonut
      title={selectedRange.label}
      emptyText="No events recorded in this period"
      data={Object.entries(actorCounts || {}).map(([key, value]) => ({
        label: ACTOR_LABELS[key] || 'Other',
        value,
      }))}
    />
  );
}

function ActorBreakdownPanel({ actors, selectedRange, range, onRangeChange }) {
  return (
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
              onChange={(event) => onRangeChange(event.target.value)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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

      <ActorBreakdownBody actors={actors} selectedRange={selectedRange} />
      <SourceNote>Server-recorded. Counts every audited action.</SourceNote>
    </Panel>
  );
}

function CaseOverviewSection({ byStatus, caseVolume, trend, funnel }) {
  const TrendIcon = TREND_ICON[trend.delta.direction] || Minus;

  return (
    <section aria-labelledby="case-activity">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="case-activity" className="font-heading text-[18px] font-semibold text-ink">
          Query cases overview
        </h2>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] font-medium text-ink-muted shadow-card">
          System-wide — cases are stored server-side
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel>
          <StatusDonut
            title="Status distribution"
            data={byStatus}
            emptyText="No cases yet"
          />
        </Panel>

        <Panel className="flex flex-col">
          <TrendLine
            title="Cases created — last 7 days"
            data={caseVolume}
            emptyText="No cases created in the last 7 days"
          />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <MiniStat icon={CalendarDays} value={trend.current} label="Total created" />
            <MiniStat
              icon={TrendIcon}
              value={trend.delta.text}
              label="vs previous 7 days"
              tone={trendTone(trend.delta.direction)}
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
  );
}

function AreaLink({ section, to }) {
  const { label, icon: Icon, description } = SECTIONS[section];

  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5',
        'motion-safe:transition-all motion-reduce:transition-none',
        'hover:border-primary-300 hover:shadow-card',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
          AREA_TINTS[section] || 'bg-slate-100 text-slate-600',
        )}
      >
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
            {description}
          </span>
        )}
      </span>

      {section === SECTION.ADMIN_SETTINGS && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          Elevated
        </span>
      )}

      <ChevronRight
        className="h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-primary rtl:rotate-180"
        aria-hidden="true"
      />
    </Link>
  );
}

function SupportCard({ supportAddress }) {
  return (
    <div
      className={cn(
        PANEL_CLASS,
        'flex items-center gap-3 border-line px-4 py-3.5 shadow-none',
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
        <HelpCircle className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink">Need help?</span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
          {supportAddress
            ? `Contact the QMS team at ${supportAddress}`
            : 'Contact the QMS team'}
        </span>
      </span>
      {supportAddress && (
        <a
          href={`mailto:${supportAddress}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          Email us <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function AdminAreasSection({ paths, supportAddress }) {
  return (
    <section aria-labelledby="console-areas">
      <Panel>
        <PanelHeader
          id="console-areas"
          title="Administration areas"
          note="Manage all aspects of the QMS platform"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AREA_SECTIONS.filter((section) => paths[section]).map((section) => (
            <AreaLink key={section} section={section} to={paths[section]} />
          ))}

          <SupportCard supportAddress={supportAddress} />
        </div>
      </Panel>
    </section>
  );
}

export function AdminOverviewPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);
  const [range, setRange] = useState('7');

  const { summary, previous, actors, recent, emailConfig, selectedRange } =
    useAdminActivity(range);

  const overall = summary.data?.overall;
  const tiles = buildKpiTiles({
    today: summary.data?.today,
    yesterday: previous.data?.overall,
    hasComparison: previous.isSuccess,
    paths,
  });

  return (
    <div className="space-y-6 pb-2">
      <DashboardHero
        userName={currentUser?.name}
        title="Administration"
        purpose="What is happening in the QMS right now, and what has happened so far."
      />

      <SystemActivitySection summary={summary} overall={overall} tiles={tiles} />

      {summary.isError && (
        <div
          role="alert"
          className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 shadow-card"
        >
          <p className="m-0 font-bold">System activity unavailable</p>
          <p className="m-0 mt-0.5 text-[13px]">
            The audit API could not be reached, so the server-recorded figures below are not shown.
            Case counts come from this browser and are unaffected.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <RecentActivityPanel recent={recent} paths={paths} />
        <ActorBreakdownPanel
          actors={actors}
          selectedRange={selectedRange}
          range={range}
          onRangeChange={setRange}
        />
      </div>

      <CaseOverviewSection
        byStatus={statusDistribution(queries)}
        caseVolume={volumeByDay(queries)}
        trend={caseTrend(queries)}
        funnel={processingFunnel(auditEvents)}
      />

      <AdminAreasSection paths={paths} supportAddress={emailConfig.data?.ipcQueryEmail} />
    </div>
  );
}
