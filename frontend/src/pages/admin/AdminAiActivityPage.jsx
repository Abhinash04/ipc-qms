import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Sparkles, PenLine, AlertTriangle } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { Skeleton } from '@/components/ui/skeleton';
import { AuditTable } from '@/components/admin/AuditTable';
import { StatusDonut } from '@/components/admin/charts';
import { fetchAuditEvents, fetchAuditSummary } from '@/services/api/adminService';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { buildPath } from '@/constants/routePaths';

export function AdminAiActivityPage() {
  const paths = useRoutePaths();
  const navigate = useNavigate();

  const summary = useQuery({ queryKey: ['audit', 'summary'], queryFn: () => fetchAuditSummary(), retry: false });
  const events = useQuery({
    queryKey: ['audit', 'ai'],
    queryFn: () => fetchAuditEvents({ actorType: 'agent', limit: 100 }),
    retry: false,
  });

  const byAction = summary.data?.overall?.byAction || {};
  const aiEvents = (events.data?.events || []).filter((event) => event.action.startsWith('AI_'));

  const withMeta = aiEvents.filter((event) => event.aiMetadata);
  const fellBack = withMeta.filter((event) => event.aiMetadata.fallback).length;
  const answered = withMeta.length - fellBack;
  const failed = aiEvents.filter((event) => event.result === 'failure').length;

  const latencies = withMeta
    .map((event) => Number(event.aiMetadata.latencyMs))
    .filter((value) => Number.isFinite(value));
  const medianLatency = latencies.length
    ? [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)]
    : null;

  const tiles = [
    {
      label: 'Summaries generated',
      value: byAction.AI_SUMMARY_GENERATED ?? 0,
      icon: Sparkles,
      cardBg: 'bg-blue-50/70',
      cardBorder: 'border-blue-200/70',
      numColor: 'text-blue-700',
      iconBg: 'bg-blue-100 text-blue-700',
    },
    {
      label: 'Drafts generated',
      value: byAction.AI_DRAFT_GENERATED ?? 0,
      icon: PenLine,
      cardBg: 'bg-violet-50/70',
      cardBorder: 'border-violet-200/70',
      numColor: 'text-violet-700',
      iconBg: 'bg-violet-100 text-violet-700',
    },
    {
      label: 'Recommendations',
      value: byAction.AI_RECOMMENDATION_GENERATED ?? 0,
      icon: Bot,
      cardBg: 'bg-emerald-50/70',
      cardBorder: 'border-emerald-200/70',
      numColor: 'text-emerald-700',
      iconBg: 'bg-emerald-100 text-emerald-700',
    },
    {
      label: 'Failed calls',
      value: failed,
      icon: AlertTriangle,
      cardBg: 'bg-rose-50/70',
      cardBorder: 'border-rose-200/70',
      numColor: 'text-rose-700',
      iconBg: 'bg-rose-100 text-rose-700',
    },
  ];

  const panel = 'rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm';

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Administration', path: paths.ADMINISTRATION },
          { label: 'AI Agent' },
        ]}
      />
      <PageHeader
        title="AI Agent"
        purpose="What the agent produced, and whether the model answered or the fallback was used."
      />

      {summary.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <StatTile key={tile.label} {...tile} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className={panel} aria-labelledby="model-health">
          <h2 id="model-health" className="mb-3 font-heading text-[17px] font-black text-slate-900">
            Model health
          </h2>
          <StatusDonut
            title="Answered by the model vs fallback"
            emptyText="No AI calls recorded yet"
            data={[
              { label: 'Model answered', value: answered },
              { label: 'Fell back', value: fellBack },
            ]}
          />
          {medianLatency !== null && (
            <p className="m-0 mt-3 border-t border-slate-100 pt-3 text-[12.5px] text-slate-600">
              Median response time{' '}
              <span className="font-black tabular-nums text-slate-900">{medianLatency} ms</span>
            </p>
          )}
          {fellBack > 0 && (
            <p className="m-0 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
              {fellBack} call{fellBack === 1 ? '' : 's'} used deterministic fallback text. Users still got a
              response — it was not written by the model.
            </p>
          )}
        </section>

        <section className={panel} aria-labelledby="ai-events">
          <h2 id="ai-events" className="mb-3 font-heading text-[17px] font-black text-slate-900">
            Agent activity
          </h2>
          <AuditTable
            events={aiEvents}
            loading={events.isLoading}
            error={events.isError ? 'The audit API could not be reached.' : null}
            onOpenQuery={(queryId) => paths.QUERY_DETAIL && navigate(buildPath(paths.QUERY_DETAIL, { queryId }))}
            emptyTitle="No AI activity recorded yet"
          />
        </section>
      </div>
    </div>
  );
}
