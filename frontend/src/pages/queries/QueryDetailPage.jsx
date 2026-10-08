import { useState } from 'react';
import {
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheckBig,
  ClipboardList,
  Clock3,
  Copy,
  FileSignature,
  FileText,
  Flag,
  FolderOpen,
  Hash,
  Inbox,
  Mail,
  Milestone,
  PenLine,
  Quote,
  Route,
  Sparkles,
  Stamp,
  Tag,
  UserRound,
} from 'lucide-react';
import { CaseCard, Pill, Segmented } from '@/components/common/CaseCard';
import { initials } from '@/utils/initials';
import { formatDate } from '@/utils/dateTime';
import { StatusBadge } from '@/components/common/StatusBadge';
import { cn } from '@/utils/cn';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { AttachmentsPanel } from '@/components/attachments/AttachmentsPanel';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { AutoTransferTimerCard } from '@/components/workflow/AutoTransferTimerCard';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { CaseSectionBar } from '@/components/workflow/CaseSectionBar';
import { WorkflowActionsCard } from '@/components/workflow/WorkflowActionsCard';
import { ReviewDecisionCard } from '@/components/workflow/ReviewDecisionCard';
import { ResubmissionCard } from '@/components/workflow/ResubmissionCard';
import { AuditHistoryCard } from '@/components/workflow/AuditHistoryCard';
import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useIsClamped } from '@/hooks/useIsClamped';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';
import { buildLifecycle, STAGE_STATUS } from '@/constants/queryLifecycle';
import { buildSpecialEvents } from '@/constants/workflowExceptions';
import { WORKFLOW_VIEW } from '@/constants/workflowSequence';
import { findUserById } from '@/constants/mockUsers';

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-primary"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

function AssigneeValue({ query }) {
  const name = findUserById(query.currentAssigneeId)?.name;
  if (!name) return <span className="text-slate-400">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-50 text-[9px] font-bold text-primary-700 ring-1 ring-primary-200" aria-hidden="true">
        {initials(name)}
      </span>
      {name}
    </span>
  );
}

function CaseDetailsPanel({ query }) {
  const tiles = [
    ['Priority', <StatusBadge key="p" type="priority" value={query.priority || 'NORMAL'} />],
    ['Category', query.category || '—'],
    ['Source', query.source || '—'],
    ['Created', formatDate(query.createdAt)],
  ];

  return (
    <CaseCard tone="context" banner art={[ClipboardList]} icon={FolderOpen} title="Case details" compact className="select-none">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">Case ID</p>
          <p className="m-0 inline-flex items-center gap-1 font-mono text-[17px] font-bold tracking-tight text-slate-900">
            {query.queryId}
            <CopyButton value={query.queryId} label="case ID" />
          </p>
        </div>
        <StatusBadge type="workflow" value={query.workflowState} />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
            <dt className="text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">{label}</dt>
            <dd className="m-0 mt-0.5 truncate text-[13px] font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
        <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg bg-primary-50/60 px-3 py-2 ring-1 ring-primary-100">
          <dt className="text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">Assignee</dt>
          <dd className="m-0 min-w-0 truncate text-[13px] font-semibold text-slate-900">
            <AssigneeValue query={query} />
          </dd>
        </div>
      </dl>
    </CaseCard>
  );
}

const VERSION_TONE = { FINAL_APPROVED: 'success', APPROVED: 'success', SUBMITTED: 'info', UNDER_REVIEW: 'info', AI_GENERATED: 'ai' };

const versionTone = (v) => VERSION_TONE[v.status] || (v.aiGenerated ? 'ai' : 'neutral');

function DraftTabContent({ query, versions, latestVersion }) {
  const [selected, setSelected] = useState(null);
  if (versions.length === 0) {
    return <EmptyState title="No draft yet" description="The assigned official has not started drafting a response." />;
  }

  const shown = versions.find((v) => v.version === selected) || latestVersion;
  const editedBy = findUserById(shown.submittedBy)?.name || shown.createdBy || null;
  const updated = shown.submittedAt || shown.updatedAt || shown.createdAt;
  const history = [...versions].reverse();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Draft versions">
        <p className="m-0 mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Version history</p>
        <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 md:flex-col md:overflow-visible">
          {history.map((v) => {
            const active = v.version === shown.version;
            return (
              <li key={v.version} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(v.version)}
                  aria-pressed={active}
                  className={cn(
                    'w-full cursor-pointer rounded-lg border px-3 py-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    active ? 'border-primary-300 bg-primary-50 shadow-xs' : 'border-slate-200 bg-card hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn('text-[14px] font-bold', active ? 'text-primary-700' : 'text-slate-800')}>{v.version}</span>
                    {v === latestVersion && <span className="text-[10.5px] font-semibold text-slate-400 uppercase">Latest</span>}
                  </span>
                  {v.label && <Pill tone={versionTone(v)} className="mt-1">{v.label}</Pill>}
                  <span className="mt-1 block text-[11.5px] text-slate-500">{formatDate(v.submittedAt || v.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100/80">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-card px-4 py-2 text-[12px] text-slate-500">
          <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="font-semibold text-slate-700">{query.queryId}-response-{shown.version}</span>
          {shown.label && <Pill tone={versionTone(shown)}>{shown.label}</Pill>}
          <span className="sm:ms-auto">
            {[editedBy && `Last edited by ${editedBy}`, updated && `Updated ${formatDate(updated)}`].filter(Boolean).join(' · ')}
          </span>
        </div>

        <div className="max-h-160 overflow-y-auto p-3 sm:p-6">
          <article
            aria-label={`Response draft ${shown.version}`}
            className="mx-auto max-w-180 rounded-sm bg-card px-6 py-7 shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_24px_-8px_rgba(15,23,42,0.18)] sm:px-12 sm:py-10"
          >
            <header className="mb-6 flex items-start justify-between gap-4 border-b-2 border-double border-slate-300 pb-4">
              <div className="flex items-center gap-3">
                <img src="/imageFile1.png" alt="" width="103" height="199" className="h-12 w-auto object-contain" />
                <div className="leading-tight">
                  <p className="m-0 text-[11px] font-semibold text-slate-600">भारतीय भेषज संहिता आयोग</p>
                  <p className="m-0 text-[12.5px] font-bold tracking-wide text-slate-900 uppercase">Indian Pharmacopoeia Commission</p>
                  <p className="m-0 text-[10.5px] text-slate-500">Ministry of Health &amp; Family Welfare, Government of India</p>
                </div>
              </div>
              <div className="hidden text-end text-[11px] leading-relaxed text-slate-500 sm:block">
                <p className="m-0">Ref: {query.queryId}</p>
                <p className="m-0">Draft {shown.version}</p>
                <p className="m-0">{formatDate(updated)}</p>
              </div>
            </header>
            <div className="font-serif text-[15px] leading-[1.85] whitespace-pre-wrap text-slate-800">{shown.content}</div>
          </article>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 bg-card px-4 py-2 text-[12px] text-slate-500">
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          Saved • Version {shown.version}
        </div>
      </div>
    </div>
  );
}

const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

function FactTile({ icon: Icon, label, children }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-slate-200 bg-card p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">{label}</dt>
        <dd className="m-0 mt-0.5 truncate text-[13.5px] font-semibold text-slate-900">{children}</dd>
      </div>
    </div>
  );
}

function EnquiryText({ text }) {
  const [open, setOpen] = useState(false);
  const [textRef, clamped] = useIsClamped(text, open);
  const long = open || clamped;
  return (
    <section aria-labelledby="query-info-enquiry">
      <h3 id="query-info-enquiry" className="m-0 mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wider text-slate-500 uppercase">
        <Quote className="h-3.5 w-3.5" aria-hidden="true" /> Original enquiry
      </h3>
      <div className="rounded-xl border border-slate-200 border-s-4 border-s-primary-400 bg-slate-50/60 px-4 py-3">
        <p ref={textRef} className={cn('m-0 max-w-[80ch] text-[13.5px] leading-relaxed whitespace-pre-wrap text-slate-800', !open && 'line-clamp-6')}>
          {text}
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[12.5px] font-semibold text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {open ? 'Show less' : 'Show full enquiry'}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function QueryInfoTab({ query }) {
  const inquirer = query.inquirer || {};
  const dates = [
    { label: 'Received', value: dateTime(query.createdAt), Icon: Inbox },
    { label: 'Last updated', value: dateTime(query.updatedAt), Icon: Clock3 },
    { label: 'Due', value: dateTime(query.dueDate || query.actionDeadline) || 'Not set', Icon: CalendarClock },
  ];
  const topics = query.aiSummary?.topics || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 pb-4">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-primary-700">
            {query.queryId}
            <CopyButton value={query.queryId} label="query ID" />
          </p>
          <h3 className="m-0 mt-1.5 max-w-[70ch] text-[16.5px] font-semibold leading-snug text-slate-900">{query.subject}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge type="workflow" value={query.workflowState} />
          <StatusBadge type="priority" value={query.priority || 'NORMAL'} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section aria-label="Inquirer" className="flex items-start gap-3 rounded-xl border border-slate-200 bg-linear-to-br from-primary-50/70 to-card p-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[15px] font-bold text-white" aria-hidden="true">
            {initials(inquirer.name)}
          </span>
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> Inquirer
            </p>
            <p className="m-0 truncate text-[15px] font-semibold text-slate-900">{inquirer.name || '—'}</p>
            {inquirer.email && (
              <a
                href={`mailto:${inquirer.email}`}
                className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-[12.5px] text-primary-700 hover:underline"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{inquirer.email}</span>
              </a>
            )}
            <p className="m-0 mt-1 text-[12px] text-slate-500">External inquirer · via {query.source || 'email'}</p>
          </div>
        </section>

        <section aria-label="Key dates" className="rounded-xl border border-slate-200 bg-card p-4">
          <p className="m-0 mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Key dates
          </p>
          <ol className="m-0 list-none space-y-2 p-0">
            {dates.map(({ label, value, Icon }) => (
              <li key={label} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-hidden="true">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="w-24 shrink-0 text-[12px] text-slate-500">{label}</span>
                <span className="min-w-0 truncate text-[13px] font-semibold text-slate-900">{value || '—'}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FactTile icon={Tag} label="Category">{query.category || '—'}</FactTile>
        <FactTile icon={Mail} label="Source">{query.source || '—'}</FactTile>
        <FactTile icon={Briefcase} label="Assigned to">
          <AssigneeValue query={query} />
        </FactTile>
        <FactTile icon={Hash} label="Thread">
          <span className="font-mono text-[12.5px]">{query.threadId || '—'}</span>
        </FactTile>
      </dl>

      {query.description && <EnquiryText text={query.description} />}

      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wider text-slate-500 uppercase">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI topics
          </span>
          {topics.map((topic) => (
            <span key={topic} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[12px] font-semibold text-violet-800 ring-1 ring-violet-200">
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CaseWorkspaceTabs({ query, versions, latestVersion }) {
  return (
    <CaseCard
      tone="document"
      banner
      art={[FileSignature, PenLine, Stamp]}
      icon={FileText}
      title="Response workspace"
      meta={latestVersion ? `Latest draft ${latestVersion.version}` : 'No draft yet'}
      bodyClassName="pt-0"
    >
      <Tabs defaultValue="draft">
        <div className="-mx-4 overflow-x-auto border-b border-slate-200/60 px-4 sm:-mx-5 sm:px-5">
          <TabsList variant="line">
            <TabsTrigger value="draft">Response Draft</TabsTrigger>
            <TabsTrigger value="info">Query Info</TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="draft" className="mt-0 pt-4">
          <DraftTabContent query={query} versions={versions} latestVersion={latestVersion} />
        </TabsContent>

        <TabsContent value="info" className="mt-0 pt-2">
          <QueryInfoTab query={query} />
        </TabsContent>

        <TabsContent value="attachments" className="mt-0 pt-4">
          <AttachmentsPanel attachments={query.attachments} emptyDescription="No attachments available for this query." />
        </TabsContent>
      </Tabs>
    </CaseCard>
  );
}

function CaseInsightPanels({ query, canAssign, currentUser, assignQuery, readOnly }) {
  return (
    <>
      <div id="case-summary" className="scroll-mt-36">
        <AiSummaryCard
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

      {canAssign && (
        <div data-slot="panel" className="rounded-[13px] border border-violet-200/70 bg-card p-4 shadow-xs sm:p-5">
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

// Full labels from `sm` up, short ones on a phone.
const viewLabel = (full, short) => (
  <>
    <span className="hidden sm:inline">{full}</span>
    <span className="sm:hidden">{short}</span>
  </>
);

const WORKFLOW_VIEWS = [
  { value: WORKFLOW_VIEW.ALL, label: 'All' },
  { value: WORKFLOW_VIEW.NORMAL, label: viewLabel('Normal workflow', 'Normal') },
  { value: WORKFLOW_VIEW.EXCEPTIONS, label: viewLabel('Pull backs & transfers', 'Exceptions') },
];

/** The header counts always describe the whole case; the toggle only changes what the line draws. */
function WorkflowProgressCard({ stages, events, audit }) {
  const [view, setView] = useState(WORKFLOW_VIEW.ALL);
  const completed = stages.filter((stage) => stage.status === STAGE_STATUS.COMPLETE).length;

  return (
    <CaseCard
      tone="progress"
      banner
      art={[Milestone, Flag, CircleCheckBig]}
      icon={Route}
      title="Workflow progress"
      meta={`${completed} of ${stages.length} stages complete${events.length ? ` · ${events.length} pull backs, transfers & change requests` : ''}`}
      toolbar={<Segmented label="Workflow view" options={WORKFLOW_VIEWS} value={view} onChange={setView} />}
      className="mb-5"
      bodyClassName="py-5"
    >
      <QueryLifecycleTimeline stages={stages} events={events} audit={audit} view={view} />
    </CaseCard>
  );
}



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
  const specialEvents = buildSpecialEvents({ query, audit, reviews });

  const breadcrumbItems = [
    { label: 'Dashboard', path: paths.DASHBOARD },
    { label: 'Queries', path: paths.QUERIES },
    { label: query.queryId },
  ];

  return (
    <div>
      {!readOnly && <Breadcrumb items={breadcrumbItems} />}

      <CaseSummaryBar query={query} />

      <WorkflowProgressCard stages={stages} events={specialEvents} audit={audit} />

      <div className="mb-5">
        <AutoTransferTimerCard query={query} />
      </div>

      {/* Desktop: content column and a sticky context rail. Tablet and phone: the rail's two cards
          come first, side by side then stacked, and the content follows full width. */}
      <div
        data-slot="case-workspace"
        className="mb-5 grid grid-cols-1 items-start gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
      >
        <div className="min-w-0 space-y-4 lg:space-y-5">
          {/* Read-only, the page sits in the case sheet's own scrolling panel, which has no app header. */}
          <CaseSectionBar emails={messages.length} events={audit.length} stickyClassName={readOnly ? 'top-0' : 'top-20'} />

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
            canAssign={canAssign}
            currentUser={currentUser}
            assignQuery={assignQuery}
            readOnly={readOnly}
          />

          <div id="case-email-thread" className="scroll-mt-36">
            <EmailThread messages={messages} />
          </div>

          <div id="case-response" className="scroll-mt-36">
            <CaseWorkspaceTabs query={query} versions={versions} latestVersion={latestVersion} />
          </div>

          <div id="case-audit-history" className="scroll-mt-36">
            <AuditHistoryCard audit={audit} />
          </div>
        </div>

        <aside
          aria-label="Case actions and details"
          className={
            readOnly
              ? 'order-first grid grid-cols-1 items-start gap-4 self-start md:grid-cols-2 xl:order-0 xl:grid-cols-1'
              : 'order-first grid grid-cols-1 items-start gap-4 self-start md:grid-cols-2 xl:order-0 xl:sticky xl:top-24 xl:grid-cols-1 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pe-1'
          }
        >
          {!readOnly && <WorkflowActionsCard />}
          {!readOnly && can(WORKFLOW_ACTION.APPROVE_REVIEW) && <ReviewDecisionCard />}
          <CaseDetailsPanel query={query} />
        </aside>
      </div>

    </div>
  );
}
