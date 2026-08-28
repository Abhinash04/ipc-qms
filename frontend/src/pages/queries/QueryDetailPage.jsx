import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PaperclipIcon, ShieldCheck } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { WorkflowActionsCard } from '@/components/workflow/WorkflowActionsCard';
import { ReviewDecisionCard } from '@/components/workflow/ReviewDecisionCard';
import { CaseOfficialsCard } from '@/components/workflow/CaseOfficialsCard';
import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';
import { ROLES } from '@/constants/roles';
import { isQueryOwnedBy } from '@/utils/queryOwnership';
import { buildLifecycle } from '@/constants/queryLifecycle';
import { findUserById } from '@/constants/mockUsers';

/** How many audit rows show before the reader asks for the rest. */
const AUDIT_PREVIEW = 8;

/**
 * Compact metadata for the sticky panel. CaseSummaryBar carries some of this
 * too, but that bar scrolls away — keeping the identifiers in view while
 * reading a long thread is the point.
 */
function CaseDetailsPanel({ query }) {
  const rows = [
    ['Case ID', query.queryId],
    ['Priority', query.priority || 'NORMAL'],
    ['Category', query.category || '—'],
    ['Source', query.source || '—'],
    ['Assignee', findUserById(query.currentAssigneeId)?.name || 'Unassigned'],
    [
      'Created',
      query.createdAt ? new Date(query.createdAt).toLocaleDateString('en-GB') : '—',
    ],
  ];

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm select-none">
      <h2 className="font-heading text-[17px] font-black text-slate-900 m-0 border-b border-slate-100 pb-2.5 mb-2.5">
        Case details
      </h2>
      <dl className="m-0 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
              {label}
            </dt>
            <dd className="m-0 text-[13px] font-extrabold text-slate-800 text-right truncate">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export function QueryDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, currentUser, can, steps, versions, latestVersion, reviews, audit, messages } =
    useQueryCase();
  const canAssign = can(WORKFLOW_ACTION.ASSIGN);
  const assignQuery = useWorkflowStore((state) => state.assignQuery);
  const isInquirer = currentUser?.role === ROLES.INQUIRER;
  const [showAllAudit, setShowAllAudit] = useState(false);

  // useQueryCase sorts ascending, so the newest event would otherwise be
  // buried at the bottom of an unbounded table.
  const newestFirstAudit = [...audit].reverse();
  const visibleAudit = showAllAudit
    ? newestFirstAudit
    : newestFirstAudit.slice(0, AUDIT_PREVIEW);
  const stages = buildLifecycle({ query, steps, versions, reviews, audit, messages });

  if (!query || (isInquirer && !isQueryOwnedBy(query, currentUser))) {
    return (
      <EmptyState
        title="Query not found"
        description={`No query matching ${queryId} exists in the current demo data.`}
      />
    );
  }

  return (
    <div>
      <Breadcrumb
        items={
          isInquirer
            ? [{ label: 'Dashboard', path: paths.DASHBOARD }, { label: query.queryId }]
            : [
                { label: 'Dashboard', path: paths.DASHBOARD },
                { label: 'Queries', path: paths.QUERIES },
                { label: query.queryId },
              ]
        }
      />

      <CaseSummaryBar query={query} />

      {/* Workflow is a status indicator, so it keeps the full width. */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm mb-5">
        <h2 className="font-heading text-[19px] font-black text-slate-900 mb-3 border-b border-slate-100 pb-2.5">
          Workflow progress
        </h2>
        <QueryLifecycleTimeline stages={stages} />
      </div>

      {/* One workspace grid. minmax(0,1fr) stops wide children (the audit
          table, long email bodies) blowing the left column out. */}
      <div
        className={
          isInquirer
            ? 'space-y-5 mb-5'
            : 'grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] mb-5'
        }
      >
        <div className="min-w-0 space-y-5">
          {!isInquirer && (
            <>
              <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm">
                <AiSummaryCard
                  variant="embedded"
                  summary={query.aiSummary}
                  query={query}
                  onSummaryUpdated={(newSummary) => {
                    useWorkflowStore.getState().applyTransition({
                      queryId: query.queryId,
                      actor: null,
                      actorLabel: 'AI Summary Assistant',
                      patch: { aiSummary: newSummary },
                      details: newSummary.text,
                    });
                  }}
                />
              </div>

              <CaseOfficialsCard query={query} steps={steps} audit={audit} />

              {/* Suggestions for whom to assign are only useful while the
                  assignment is still open; after that Officials is the answer. */}
              {canAssign && (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm">
                  <AiRecommendationCard
                    variant="embedded"
                    query={query}
                    currentAssigneeId={query.currentAssigneeId}
                    onAssign={(officialId) =>
                      assignQuery(query.queryId, officialId, currentUser)
                    }
                  />
                </div>
              )}
            </>
          )}

          <EmailThread messages={messages} />

          <div className="bg-white rounded-3xl border border-slate-200/80 overflow-hidden shadow-sm p-5">
          <Tabs defaultValue={isInquirer ? 'info' : 'draft'}>
            <div className="border-b border-slate-100 pb-3">
              <TabsList variant="line">
                {!isInquirer && <TabsTrigger value="draft">Response Draft</TabsTrigger>}
                <TabsTrigger value="info">Query Info</TabsTrigger>
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
              </TabsList>
            </div>

            {!isInquirer && (
              <TabsContent value="draft" className="mt-0 pt-5">
                {versions.length === 0 ? (
                  <EmptyState
                    title="No draft yet"
                    description="The assigned official has not started drafting a response."
                  />
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Versions: {versions.map((v) => v.version).join(' → ')} — showing{' '}
                      <span className="font-medium text-foreground">{latestVersion.version}</span> (
                      {latestVersion.label})
                    </p>
                    <pre className="max-h-96 overflow-y-auto rounded-2xl border border-slate-200/90 bg-slate-50 p-4 font-sans text-sm whitespace-pre-wrap text-slate-800">
                      {latestVersion.content}
                    </pre>
                  </>
                )}
              </TabsContent>
            )}

            <TabsContent value="info" className="mt-0 pt-5 space-y-1">
              <InfoRow label="Inquirer" value={query.inquirer.name} />
              <InfoRow label="Source" value={query.source} />
              <InfoRow label="Category" value={query.category} />
              <InfoRow label="Created" value={new Date(query.createdAt).toLocaleDateString()} />
              <p className="mt-3 text-sm text-slate-600">{query.description}</p>
            </TabsContent>

            <TabsContent value="attachments" className="mt-0 pt-5">
              {query.attachments.length === 0 ? (
                <EmptyState icon={PaperclipIcon} title="No attachments" />
              ) : (
                <ul className="space-y-2">
                  {query.attachments.map((att) => (
                    <li
                      key={att.id}
                      className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold"
                    >
                      <PaperclipIcon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      <span className="flex-1 text-slate-800">{att.name}</span>
                      <span className="text-xs font-bold text-slate-400">{att.sizeKb} KB</span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
          </div>
        </div>

        {!isInquirer && (
          /* Sticky so the actions stay reachable through a long thread. It
             scrolls internally rather than overflowing the viewport. */
          <div className="lg:sticky lg:top-6 self-start space-y-4 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <WorkflowActionsCard />
            {can(WORKFLOW_ACTION.APPROVE_REVIEW) && <ReviewDecisionCard />}
            <CaseDetailsPanel query={query} />
          </div>
        )}
      </div>

      {/* Audit History Card */}
      {!isInquirer && (
      <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm overflow-hidden select-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/80 flex items-center justify-center shadow-2xs">
              <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="font-heading text-[19px] font-black text-slate-900 m-0 leading-tight">
                Audit history
              </h2>
              <p className="text-[12.5px] font-medium text-slate-400 m-0">
                Append-only trail, newest first.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {audit.length > AUDIT_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllAudit((shown) => !shown)}
                className="text-[12px] font-bold text-slate-500 hover:text-indigo-700 bg-white hover:bg-indigo-50 px-3 py-1.5 rounded-xl border border-slate-200/80 transition-colors cursor-pointer"
              >
                {showAllAudit ? 'Show recent only' : `Show all ${audit.length} events`}
              </button>
            )}
            <span className="text-[12.5px] font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200/80 shadow-2xs">
              {audit.length} Total Events
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/70">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[13.5px] font-black text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-4">Event</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Details</th>
                <th className="py-2.5 px-4 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[15px]">
              {visibleAudit.map((entry) => {
                const rawEvent = String(entry.event || entry.action || '').toUpperCase();
                const eventText = rawEvent.replace(/_/g, ' ') || '—';
                const isAi = entry.actor?.toLowerCase().includes('ai') || entry.actor?.toLowerCase().includes('assistant');
                const isSystem = entry.actor?.toLowerCase() === 'system';
                const isRejected = rawEvent.includes('REJECT');

                let badgeColor = "bg-blue-50 text-blue-700 border-blue-200";
                if (isRejected) badgeColor = "bg-rose-50 text-rose-700 border-rose-200";
                else if (rawEvent.includes('CLOSED') || rawEvent.includes('REGISTERED')) badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                else if (rawEvent.includes('AI') || rawEvent.includes('DRAFT')) badgeColor = "bg-purple-50 text-purple-700 border-purple-200";
                else if (rawEvent.includes('FORWARD') || rawEvent.includes('ASSIGN')) badgeColor = "bg-amber-50 text-amber-800 border-amber-200";

                return (
                  <tr key={entry.auditId} className="hover:bg-slate-50/60 transition-colors">
                    {/* Event Badge */}
                    <td className="py-2 px-4 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center text-[13px] font-black px-3 py-1 rounded-full border shadow-2xs ${badgeColor}`}>
                        {eventText}
                      </span>
                    </td>

                    {/* Actor Pill */}
                    <td className="py-2 px-4 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-[14px] font-bold px-2.5 py-1 rounded-xl border ${isAi
                          ? 'bg-purple-50 text-purple-800 border-purple-200'
                          : isSystem
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                        }`}>
                        {isAi ? '🤖 ' : isSystem ? '⚙️ ' : '👤 '}
                        {entry.actor}
                      </span>
                    </td>

                    {/* Details */}
                    <td className="py-2 px-4 align-top font-medium text-slate-700 max-w-md leading-relaxed">
                      {entry.details || '—'}
                    </td>

                    {/* Timestamp */}
                    <td className="py-2 px-4 align-top text-right whitespace-nowrap font-semibold text-slate-400 text-[14px]">
                      {new Date(entry.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      <span className="mx-1">•</span>
                      {new Date(entry.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {!isInquirer && (
      <p className="mt-4 text-xs text-muted-foreground">
        Stage-specific actions also live on their dedicated pages —{' '}
        <Link to={paths.ASSIGNMENTS || '#'} className="text-ring hover:underline">
          Assignments
        </Link>
        ,{' '}
        <Link to={paths.DRAFTING || '#'} className="text-ring hover:underline">
          Drafting
        </Link>
        ,{' '}
        <Link to={paths.REVIEWS || '#'} className="text-ring hover:underline">
          Reviews
        </Link>
        ,{' '}
        <Link to={paths.APPROVALS || '#'} className="text-ring hover:underline">
          Approvals
        </Link>
        ,{' '}
        <Link to={paths.DISPATCH || '#'} className="text-ring hover:underline">
          Dispatch
        </Link>
        .
      </p>
      )}
    </div>
  );
}
