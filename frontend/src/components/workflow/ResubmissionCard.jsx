import { useState } from 'react';
import { ArrowRight, ChevronDown, GitCompareArrows, History, RotateCcw } from 'lucide-react';
import { CaseCard, Pill } from '@/components/common/CaseCard';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { currentResubmission, requesterRole } from '@/constants/reviewRounds';
import { lineDiff } from '@/utils/lineDiff';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dateTime';

const IN_REVIEW = [WORKFLOW_STATE.UNDER_REVIEW, WORKFLOW_STATE.PENDING_FINAL_APPROVAL];

const when = formatDateTime;

function reviewingNow(query, currentStep, steps) {
  if (query?.workflowState === WORKFLOW_STATE.PENDING_FINAL_APPROVAL) return 'Final approval';
  return currentStep ? requesterRole({ stepId: currentStep.stepId }, steps) : 'Review';
}

function Step({ title, detail, tone = 'muted' }) {
  return (
    <li className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
      <p
        className={cn(
          'text-xs font-semibold',
          tone === 'orange' && 'text-status-orange-fg',
          tone === 'blue' && 'text-status-blue-fg',
          tone === 'muted' && 'text-foreground',
        )}
      >
        {title}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </p>
    </li>
  );
}

function Arrow() {
  return (
    <li aria-hidden="true" className="hidden shrink-0 items-center text-muted-foreground sm:flex">
      <ArrowRight className="h-3.5 w-3.5" />
    </li>
  );
}

function Quote({ label, who, children }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{who}</p>
      <blockquote className="mt-1.5 border-l-2 border-status-orange-line pl-3 text-sm whitespace-pre-wrap text-foreground">
        {children}
      </blockquote>
    </div>
  );
}

const DIFF_STYLE = {
  added: { mark: '+', className: 'bg-status-green-bg text-status-green-fg' },
  removed: { mark: '−', className: 'bg-status-red-bg text-status-red-fg line-through decoration-status-red-fg/40' },
  same: { mark: ' ', className: 'text-muted-foreground' },
};

// A row's line numbers in the old and the new text identify it ("-" where it has none).
function withLineKeys(rows) {
  let oldLine = 0;
  let newLine = 0;
  return rows.map((row) => {
    if (row.type !== 'added') oldLine += 1;
    if (row.type !== 'removed') newLine += 1;
    const key = `${row.type === 'added' ? '-' : oldLine}:${row.type === 'removed' ? '-' : newLine}`;
    return { ...row, key };
  });
}

function VersionDiff({ before, after }) {
  const rows = withLineKeys(lineDiff(before?.content ?? '', after?.content ?? ''));
  const changed = rows.filter((r) => r.type !== 'same').length;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {changed === 0
          ? 'The text is identical — the officer changed nothing in the wording.'
          : `${rows.filter((r) => r.type === 'added').length} line(s) added, ${
              rows.filter((r) => r.type === 'removed').length
            } removed.`}
      </p>
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs leading-5">
        {rows.map((row) => {
          const style = DIFF_STYLE[row.type];
          return (
            <div key={row.key} className={cn('flex gap-2 px-1', style.className)} data-diff={row.type}>
              <span aria-hidden="true" className="w-3 shrink-0 select-none text-center">
                {style.mark}
              </span>
              <span className="sr-only">{row.type === 'same' ? '' : `${row.type}: `}</span>
              <span className="whitespace-pre-wrap wrap-break-word">{row.text || ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function EarlierRounds({ rounds }) {
  const [open, setOpen] = useState(false);
  if (!rounds.length) return null;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        Earlier rounds ({rounds.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {rounds.map((r) => (
            <li key={r.request.reviewId} className="rounded-md border border-dashed border-border px-3 py-2 text-xs">
              <p className="font-semibold text-foreground">
                Round {r.round}: {r.requesterRole} ({r.requestedBy}) {r.rejected ? 'rejected' : 'returned'} {r.reviewedVersion?.version || 'a version'}
                {r.resubmittedVersion ? ` → ${r.resubmittedVersion.version}` : ''}
              </p>
              <p className="mt-0.5 text-muted-foreground">{r.rejected ? 'Reason' : 'Requested'}: {r.request.comment}</p>
              {r.resubmittedVersion?.changeSummary && (
                <p className="mt-0.5 text-muted-foreground">Implemented: {r.resubmittedVersion.changeSummary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResubmissionTimeline({ query, current, before, latestVersion, officer, currentStep, steps }) {
  return (
    <ol aria-label="How this version came about" className="flex flex-col gap-2 sm:flex-row">
      <Step title={`${before?.version || 'Previous'} reviewed`} detail={when(current.request.at)} />
      <Arrow />
      <Step
        tone="orange"
        title={current.rejected ? 'Rejected' : 'Changes requested'}
        detail={`${current.requesterRole} · ${current.requestedBy}`}
      />
      <Arrow />
      <Step title={`${latestVersion.version} updated`} detail={`${officer} · ${when(latestVersion.submittedAt)}`} />
      <Arrow />
      <Step tone="blue" title="Under review now" detail={reviewingNow(query, currentStep, steps)} />
    </ol>
  );
}

function VersionCompare({ before, after }) {
  const [comparing, setComparing] = useState(false);
  if (!before) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={comparing}
        onClick={() => setComparing((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
      >
        <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
        {comparing ? 'Hide comparison' : `Compare ${before.version} → ${after.version}`}
      </button>
      {comparing && <VersionDiff before={before} after={after} />}
    </div>
  );
}

export function ResubmissionCard({ query, reviews, versions, steps, latestVersion, currentStep }) {
  const inReview = IN_REVIEW.includes(query?.workflowState);
  const found = inReview ? currentResubmission({ reviews, versions, steps, latestVersion }) : null;
  if (!found) return null;

  const { current, earlier } = found;
  const officer = findUserById(latestVersion.submittedBy)?.name || latestVersion.createdBy || 'The assigned official';
  const before = current.reviewedVersion;

  return (
    <CaseCard
      banner
      art={[GitCompareArrows, RotateCcw, History]}
      icon={RotateCcw}
      title={current.rejected ? 'Resubmitted after rejection' : 'Resubmitted after changes requested'}
      badge={<Pill tone="warning">Round {current.round}</Pill>}
      meta={`You are reviewing ${latestVersion.version}. ${before?.version || 'The previous version'} was ${
        current.rejected ? 'rejected' : 'returned'
      } by ${current.requesterRole} — what was asked and what changed are below.`}
      bodyClassName="space-y-4"
    >
      <ResubmissionTimeline
        query={query}
        current={current}
        before={before}
        latestVersion={latestVersion}
        officer={officer}
        currentStep={currentStep}
        steps={steps}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Quote
          label={current.rejected ? 'Rejection reason' : 'Changes requested'}
          who={`${current.requesterRole} (${current.requestedBy}) on ${before?.version || 'the previous version'}, ${when(current.request.at)}`}
        >
          {current.request.comment}
        </Quote>
        <Quote label="Changes implemented" who={`${officer} in ${latestVersion.version}, ${when(latestVersion.submittedAt)}`}>
          {latestVersion.changeSummary || 'No note was recorded.'}
        </Quote>
      </div>

      <VersionCompare before={before} after={latestVersion} />

      <EarlierRounds rounds={earlier} />
    </CaseCard>
  );
}
