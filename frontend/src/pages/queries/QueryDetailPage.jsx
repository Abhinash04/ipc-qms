import { Link } from 'react-router-dom';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { AttachmentList } from '@/components/attachments/AttachmentList';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { AutoTransferTimerCard } from '@/components/workflow/AutoTransferTimerCard';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { WorkflowActionsCard } from '@/components/workflow/WorkflowActionsCard';
import { ReviewDecisionCard } from '@/components/workflow/ReviewDecisionCard';
import { ResubmissionCard } from '@/components/workflow/ResubmissionCard';
import { CaseOfficialsCard } from '@/components/workflow/CaseOfficialsCard';
import { AuditHistoryCard } from '@/components/workflow/AuditHistoryCard';
import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';
import { buildLifecycle } from '@/constants/queryLifecycle';
import { findUserById } from '@/constants/mockUsers';

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
    <div data-slot="panel" className="bg-card rounded-2xl border border-transparent p-5 shadow-card select-none">
      <h2 className="font-heading text-[17px] font-bold text-slate-900 m-0 border-b border-slate-100 pb-2.5 mb-2.5">
        Case details
      </h2>
      <dl className="m-0 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
              {label}
            </dt>
            <dd className="m-0 text-[13px] font-semibold text-slate-800 text-right truncate">
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

function DraftTabContent({ versions, latestVersion }) {
  if (versions.length === 0) {
    return (
      <EmptyState
        title="No draft yet"
        description="The assigned official has not started drafting a response."
      />
    );
  }

  return (
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
  );
}

function CaseWorkspaceTabs({ query, versions, latestVersion }) {
  return (
    <div data-slot="panel" className="bg-card rounded-2xl border border-transparent overflow-hidden shadow-card p-5">
      <Tabs defaultValue="draft">
        <div className="border-b border-slate-100 pb-3">
          <TabsList variant="line">
            <TabsTrigger value="draft">Response Draft</TabsTrigger>
            <TabsTrigger value="info">Query Info</TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="draft" className="mt-0 pt-5">
          <DraftTabContent versions={versions} latestVersion={latestVersion} />
        </TabsContent>

        <TabsContent value="info" className="mt-0 pt-5 space-y-1">
          <InfoRow label="Inquirer" value={query.inquirer.name} />
          <InfoRow label="Source" value={query.source} />
          <InfoRow label="Category" value={query.category} />
          <InfoRow label="Created" value={new Date(query.createdAt).toLocaleDateString()} />
          <p className="mt-3 text-sm text-slate-600">{query.description}</p>
        </TabsContent>

        <TabsContent value="attachments" className="mt-0 pt-5">
          <AttachmentList attachments={query.attachments} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CaseInsightPanels({ query, steps, audit, canAssign, currentUser, assignQuery, readOnly }) {
  return (
    <>
      <div data-slot="panel" className="bg-card rounded-2xl border border-transparent p-5 shadow-card">
        <AiSummaryCard
          variant="embedded"
          readOnly={readOnly}
          summary={query.aiSummary}
          query={query}
          onSummaryUpdated={(newSummary) => {
            useWorkflowStore.getState().applyTransition({
              queryId: query.queryId,
              actor: null,
              actorLabel: 'AI Summary Assistant',
              event: AUDIT_EVENT.AI_SUMMARY_GENERATED,
              patch: { aiSummary: newSummary },
              details: newSummary.text,
            });
          }}
        />
      </div>

      <CaseOfficialsCard query={query} steps={steps} audit={audit} />

      {canAssign && (
        <div data-slot="panel" className="bg-card rounded-2xl border border-transparent p-5 shadow-card">
          <AiRecommendationCard
            variant="embedded"
            query={query}
            currentAssigneeId={query.currentAssigneeId}
            onAssign={(officialId, ranking) => assignQuery(query.queryId, officialId, currentUser, ranking)}
          />
        </div>
      )}
    </>
  );
}

const STAGE_LINKS = [
  ['ASSIGNMENTS', 'Assignments'],
  ['DRAFTING', 'Drafting'],
  ['REVIEWS', 'Reviews'],
  ['APPROVALS', 'Approvals'],
  ['DISPATCH', 'Dispatch'],
];

function StageLinksFooter({ paths }) {
  return (
    <p className="mt-4 text-xs text-muted-foreground">
      Stage-specific actions also live on their dedicated pages —{' '}
      {STAGE_LINKS.map(([key, label], index) => (
        <span key={key}>
          <Link to={paths[key] || '#'} className="text-ring hover:underline">
            {label}
          </Link>
          {index < STAGE_LINKS.length - 1 ? ', ' : '.'}
        </span>
      ))}
    </p>
  );
}

/**
 * The case page. `readOnly` (with `queryId`) is the same page for looking only, used by the audit
 * pages: no breadcrumb, no workflow actions, no assignment and no AI re-generation, while every
 * section still opens, expands and filters as it does here.
 */
export function QueryDetailPage({ queryId: viewedQueryId = null, readOnly = false } = {}) {
  const paths = useRoutePaths();
  const {
    queryId,
    query,
    currentUser,
    can,
    steps,
    stepHistory,
    currentStep,
    versions,
    latestVersion,
    reviews,
    audit,
    messages,
    resolving,
  } = useQueryCase(viewedQueryId);
  const canAssign = !readOnly && can(WORKFLOW_ACTION.ASSIGN);
  const assignQuery = useWorkflowStore((state) => state.assignQuery);

  if (!query) {
    return (
      <EmptyState
        title={resolving ? 'Loading case…' : 'Query not found'}
        description={resolving ? undefined : `No query matching ${queryId} exists in the current demo data.`}
      />
    );
  }

  const stages = buildLifecycle({ query, steps, versions, reviews, audit, messages });

  const breadcrumbItems = [
    { label: 'Dashboard', path: paths.DASHBOARD },
    { label: 'Queries', path: paths.QUERIES },
    { label: query.queryId },
  ];

  return (
    <div>
      {!readOnly && <Breadcrumb items={breadcrumbItems} />}

      <CaseSummaryBar query={query} />

      <div className="mb-5">
        <AutoTransferTimerCard query={query} />
      </div>

      <div data-slot="panel" className="bg-card rounded-2xl border border-transparent p-5 shadow-card mb-5">
        <h2 className="font-heading text-[19px] font-bold text-slate-900 mb-3 border-b border-slate-100 pb-2.5">
          Workflow progress
        </h2>
        <QueryLifecycleTimeline stages={stages} />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] mb-5">
        <div className="min-w-0 space-y-5">
          <ResubmissionCard
            query={query}
            reviews={reviews}
            versions={versions}
            steps={[...steps, ...(stepHistory || [])]}
            latestVersion={latestVersion}
            currentStep={currentStep}
          />

          <CaseInsightPanels
            query={query}
            steps={steps}
            audit={audit}
            canAssign={canAssign}
            currentUser={currentUser}
            assignQuery={assignQuery}
            readOnly={readOnly}
          />

          <EmailThread messages={messages} />

          <CaseWorkspaceTabs query={query} versions={versions} latestVersion={latestVersion} />
        </div>

        <div
          className={
            readOnly
              ? 'self-start space-y-4'
              : 'lg:sticky lg:top-24 self-start space-y-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto'
          }
        >
          {!readOnly && <WorkflowActionsCard />}
          {!readOnly && can(WORKFLOW_ACTION.APPROVE_REVIEW) && <ReviewDecisionCard />}
          <CaseDetailsPanel query={query} />
        </div>
      </div>

      <AuditHistoryCard audit={audit} />

      {!readOnly && <StageLinksFooter paths={paths} />}
    </div>
  );
}
