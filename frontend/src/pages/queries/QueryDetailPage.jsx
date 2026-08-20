import { Link } from 'react-router-dom';
import { PaperclipIcon, ShieldCheck } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { WorkflowActionsCard } from '@/components/workflow/WorkflowActionsCard';
import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';

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
  const { queryId, query, currentUser, can, steps, versions, latestVersion, audit, messages, currentStep } =
    useQueryCase();
  const canAssign = can(WORKFLOW_ACTION.ASSIGN);
  const assignQuery = useWorkflowStore((state) => state.assignQuery);

  if (!query) {
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
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Queries', path: paths.QUERIES },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Workflow Progress Card */}
          <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm">
            <h2 className="font-heading text-[18px] font-black text-slate-900 mb-5 border-b border-slate-100 pb-3">
              Workflow progress
            </h2>
            <WorkflowTimeline steps={steps} currentStepId={currentStep?.stepId} />
          </div>

          <AiSummaryCard
            summary={query.aiSummary}
            query={query}
            onSummaryUpdated={(newSummary) => {
              useWorkflowStore.getState().applyTransition({
                queryId: query.queryId,
                actor: null,
                actorLabel: 'Gemma AI Summary Assistant',
                patch: { aiSummary: newSummary },
                details: newSummary.text,
              });
            }}
          />

          <AiRecommendationCard
            query={query}
            currentAssigneeId={query.currentAssigneeId}
            onAssign={canAssign ? (officialId) => assignQuery(query.queryId, officialId, currentUser) : null}
          />

          <EmailThread messages={messages} />

          <div className="bg-white rounded-3xl border border-slate-200/80 overflow-hidden shadow-sm p-6">
            <Tabs defaultValue="draft">
              <div className="border-b border-slate-100 pb-3">
                <TabsList variant="line">
                  <TabsTrigger value="draft">Response Draft</TabsTrigger>
                  <TabsTrigger value="info">Query Info</TabsTrigger>
                  <TabsTrigger value="attachments">Attachments</TabsTrigger>
                </TabsList>
              </div>

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
                    <pre className="rounded-2xl border border-slate-200/90 bg-slate-50 p-4 font-sans text-sm whitespace-pre-wrap text-slate-800">
                      {latestVersion.content}
                    </pre>
                  </>
                )}
              </TabsContent>

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

        <div className="lg:col-span-1">
          <WorkflowActionsCard />
        </div>
      </div>

      {/* Audit History Card */}
      <div className="mt-6 bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm overflow-hidden select-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5 mb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100/80 flex items-center justify-center font-bold shadow-2xs">
              <ShieldCheck className="h-5.5 w-5.5" strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="font-heading text-[22px] font-black text-slate-900 m-0 leading-tight">
                Audit history
              </h2>
              <p className="text-[13px] font-medium text-slate-400 m-0 mt-0.5">
                Append-only audit trail — {audit.length} event{audit.length === 1 ? '' : 's'} recorded.
              </p>
            </div>
          </div>

          <span className="text-[12.5px] font-black text-indigo-700 bg-indigo-50 px-3.5 py-1.5 rounded-full border border-indigo-200/80 shadow-2xs">
            {audit.length} Total Events
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/70">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11.5px] font-black text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4">Event</th>
                <th className="py-3.5 px-4">Actor</th>
                <th className="py-3.5 px-4">Details</th>
                <th className="py-3.5 px-4 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13.5px]">
              {audit.map((entry) => {
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
                    <td className="py-3.5 px-4 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center text-[11.5px] font-black px-3 py-1 rounded-full border shadow-2xs ${badgeColor}`}>
                        {eventText}
                      </span>
                    </td>

                    {/* Actor Pill */}
                    <td className="py-3.5 px-4 align-top whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold px-2.5 py-1 rounded-xl border ${
                        isAi 
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
                    <td className="py-3.5 px-4 align-top font-medium text-slate-700 max-w-md leading-relaxed">
                      {entry.details || '—'}
                    </td>

                    {/* Timestamp */}
                    <td className="py-3.5 px-4 align-top text-right whitespace-nowrap font-semibold text-slate-400 text-[12.5px]">
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
    </div>
  );
}
