import { useState } from 'react';
import {
  SparklesIcon,
  Trash2Icon,
  Loader2,
  ClipboardCheck,
  FileSignature,
  GitBranch,
  History,
  ListOrdered,
  PenLine,
} from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseCard } from '@/components/common/CaseCard';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { findUserById } from '@/constants/mockUsers';
import { reviewLevelName } from '@/constants/queryLifecycle';
import { pendingChangeRequest, requesterRole } from '@/constants/reviewRounds';
import { formatDateTime } from '@/utils/dateTime';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';
import { AddReviewLevelField } from '@/components/workflow/AddReviewLevelField';
import { PreviousReviewCycles } from '@/components/workflow/PreviousReviewCycles';

const levelName = reviewLevelName;

function reviewStatusVariant(status) {
  if (status === 'COMPLETED') return 'status-green';
  if (status === 'IN_PROGRESS') return 'status-blue';
  return 'status-gray';
}

function ReturnedForRevisionNotice({ review, steps }) {
  const rejected = review.decision === 'REJECTED';
  const who = findUserById(review.reviewerId)?.name || 'A reviewer';
  return (
    <div
      className={
        rejected
          ? 'mb-6 rounded-md border border-status-red-line bg-status-red-bg px-4 py-3 text-sm text-status-red-fg'
          : 'mb-6 rounded-md border border-status-orange-line bg-status-orange-bg px-4 py-3 text-sm text-status-orange-fg'
      }
    >
      <p className="font-medium">{rejected ? 'Rejected at final approval' : 'Returned for revision'}</p>
      <p className="mt-0.5 text-xs">
        {who} ({requesterRole(review, steps)}) · {review.version || 'response'} · {formatDateTime(review.at)}
      </p>
      <p className="mt-1">{review.comment || 'No comment provided.'}</p>
    </div>
  );
}

function submitBlockedReason(isDirty, hasReviewers, resubmit) {
  if (isDirty) return 'Save your changes as a version first';
  if (!hasReviewers) return 'Add at least one review level first';
  if (resubmit && !resubmit.newVersionSaved) return 'Save a new version with the requested changes first';
  if (resubmit && !resubmit.note.trim()) return 'Describe the changes you implemented first';
  return undefined;
}

function ChangesImplementedField({ resubmit }) {
  return (
    <div className="space-y-1.5 rounded-md border border-status-orange-line bg-status-orange-bg/40 p-3">
      <label htmlFor="changes-implemented" className="text-sm font-medium text-foreground">
        Changes implemented <span className="text-status-red-fg">*</span>
      </label>
      <Textarea
        id="changes-implemented"
        value={resubmit.note}
        onChange={(e) => resubmit.onNote(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Tell the reviewers what you changed in response to the request"
      />
      <p className="text-xs text-muted-foreground">
        Shown to every reviewer and the Officer-in-Charge beside the original request.
      </p>
    </div>
  );
}

function DraftActions({
  can,
  running,
  isDirty,
  draft,
  versions,
  reviewSteps,
  resubmit,
  onGenerate,
  onSave,
  onSubmit,
}) {
  if (!can(WORKFLOW_ACTION.SAVE_DRAFT)) {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Drafting is available to the assigned official while the query is in ASSIGNED, DRAFTING, or
        RETURNED_FOR_REVISION.
      </p>
    );
  }

  const blocked = submitBlockedReason(isDirty, reviewSteps.length > 0, resubmit);

  return (
    <div className="space-y-3">
      {resubmit && can(WORKFLOW_ACTION.SUBMIT_FOR_REVIEW) && (
        <ChangesImplementedField resubmit={resubmit} />
      )}
      <div className="flex flex-wrap gap-2">
        {can(WORKFLOW_ACTION.GENERATE_AI_DRAFT) && (
          <Button variant="secondary" disabled={running} onClick={onGenerate}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SparklesIcon className="h-4 w-4" aria-hidden="true" />
            )}
            {running ? 'Generating…' : 'Generate AI draft'}
          </Button>
        )}

        <Button disabled={!isDirty || !draft.trim()} onClick={onSave}>
          Save new version
        </Button>

        {can(WORKFLOW_ACTION.SUBMIT_FOR_REVIEW) && versions.length > 0 && (
          <Button variant="secondary" disabled={Boolean(blocked)} title={blocked} onClick={onSubmit}>
            {resubmit ? 'Resubmit for review' : 'Submit for review'}
          </Button>
        )}
      </div>
    </div>
  );
}

function DraftEditorCard({
  latestVersion,
  versions,
  draft,
  onDraftChange,
  can,
  running,
  isDirty,
  reviewSteps,
  resubmit,
  onGenerate,
  onSave,
  onSubmit,
}) {
  return (
    <CaseCard
      tone="document"
      banner
      art={[FileSignature, PenLine, SparklesIcon]}
      icon={PenLine}
      title="Response draft"
      meta={latestVersion ? `Editing from ${latestVersion.version} (${latestVersion.label})` : undefined}
      bodyClassName="space-y-4"
    >
      {versions.length === 0 ? (
        <EmptyState
          icon={SparklesIcon}
          title="No draft yet"
          description="Generate an AI first draft to get started, or write one from scratch."
        />
      ) : (
        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          rows={14}
          className="resize-none"
          disabled={!can(WORKFLOW_ACTION.SAVE_DRAFT)}
        />
      )}

      <DraftActions
        can={can}
        running={running}
        isDirty={isDirty}
        draft={draft}
        versions={versions}
        reviewSteps={reviewSteps}
        resubmit={resubmit}
        onGenerate={onGenerate}
        onSave={onSave}
        onSubmit={onSubmit}
      />

      <p className="text-xs text-muted-foreground">
        AI-generated content never becomes the final response automatically — a human must review
        and can edit it. Every save appends a new version; previous versions are never
        overwritten.
      </p>
    </CaseCard>
  );
}

function ReviewChainRow({ step, index, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div>
        <p className="text-sm font-medium text-foreground">{levelName(index)}</p>
        <p className="text-xs text-muted-foreground">{findUserById(step.assignedUserId)?.name}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant={reviewStatusVariant(step.status)}>{step.status}</Badge>
        {onDelete && step.status === 'PENDING' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${levelName(index)}`}
            onClick={() => onDelete(step.stepId)}
          >
            <Trash2Icon className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewChainCard({
  reviewSteps,
  deleteError,
  onDelete,
  can,
  newReviewer,
  onNewReviewerChange,
  onAddReviewer,
}) {
  return (
    <CaseCard
      banner
      compact
      art={[ClipboardCheck]}
      icon={ListOrdered}
      title="Review chain"
      meta="The response passes each level in order before it reaches the Officer-in-Charge."
      bodyClassName="space-y-3"
    >
      {reviewSteps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No reviewer chosen yet — the draft cannot be submitted until you add one.
        </p>
      ) : (
        reviewSteps.map((step, index) => (
          <ReviewChainRow
            key={step.stepId}
            step={step}
            index={index}
            onDelete={can(WORKFLOW_ACTION.DELETE_REVIEW_LEVEL) ? onDelete : null}
          />
        ))
      )}

      {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

      {can(WORKFLOW_ACTION.ADD_REVIEW_LEVEL) && (
        <AddReviewLevelField
          label={`Add ${levelName(reviewSteps.length)}`}
          value={newReviewer}
          onChange={onNewReviewerChange}
          onAdd={onAddReviewer}
        />
      )}

      <p className="text-xs text-muted-foreground">
        If a reviewer requests changes the response comes back to you for a new version, and the
        chain restarts at {levelName(0)}.
      </p>
    </CaseCard>
  );
}

function VersionHistoryCard({ versions }) {
  return (
    <CaseCard
      banner
      compact
      art={[GitBranch]}
      icon={History}
      title="Version history"
      meta={versions.length > 0 ? `${versions.length} ${versions.length === 1 ? 'version' : 'versions'}` : undefined}
      bodyClassName="space-y-3"
    >
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      ) : (
        versions.map((v) => (
          <div
            key={v.responseId}
            className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0 last:pb-0"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-foreground">{v.version}</p>
                {v.aiGenerated && (
                  <Badge variant="status-indigo" className="text-[10px]">
                    AI
                  </Badge>
                )}
                {v.submittedAt && (
                  <Badge
                    variant={v.respondsToReviewId ? 'status-orange' : 'status-blue'}
                    className="text-[10px]"
                    title={v.changeSummary ? `Changes implemented: ${v.changeSummary}` : undefined}
                  >
                    {v.respondsToReviewId ? 'Resubmitted' : 'Submitted'}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {v.label} · {v.createdBy}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(v.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))
      )}
    </CaseCard>
  );
}

export function DraftingDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, versions, latestVersion, reviews, steps, stepHistory, currentUser, can, resolving } =
    useQueryCase();
  const { run, running, error, clearError } = useWorkflowAction();
  const generateAiDraft = useWorkflowStore((state) => state.generateAiDraft);
  const saveDraftVersion = useWorkflowStore((state) => state.saveDraftVersion);
  const submitForReview = useWorkflowStore((state) => state.submitForReview);
  const addReviewLevel = useWorkflowStore((state) => state.addReviewLevel);
  const deleteReviewLevel = useWorkflowStore((state) => state.deleteReviewLevel);
  const [edited, setEdited] = useState(null);
  const [newReviewer, setNewReviewer] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [changeNote, setChangeNote] = useState('');
  const draft = edited ?? latestVersion?.content ?? '';

  if (!query) return <EmptyState title={resolving ? 'Loading case…' : 'Query not found'} />;

  const latestReturn = pendingChangeRequest({ reviews, versions, query });
  const wasReturned = query.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION || Boolean(latestReturn);
  const isDirty = edited !== null && edited !== (latestVersion?.content ?? '');
  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const resubmit = latestReturn
    ? {
        note: changeNote,
        onNote: setChangeNote,
        newVersionSaved: Boolean(latestVersion) && latestVersion.responseId !== latestReturn?.responseId,
      }
    : null;

  const handleDelete = (stepId) => {
    const result = deleteReviewLevel(queryId, stepId, currentUser);
    setDeleteError(result.ok ? null : result.reason);
  };

  const handleSave = () => {
    saveDraftVersion(
      queryId,
      draft,
      currentUser,
      wasReturned ? 'Reviewer requested revision' : 'Officer revision',
    );
    setEdited(null);
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Drafting', path: paths.DRAFTING },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <ActionError message={error} onDismiss={clearError} />
      {wasReturned && latestReturn && (
        <ReturnedForRevisionNotice review={latestReturn} steps={[...steps, ...(stepHistory || [])]} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DraftEditorCard
            latestVersion={latestVersion}
            versions={versions}
            draft={draft}
            onDraftChange={setEdited}
            can={can}
            running={running}
            isDirty={isDirty}
            reviewSteps={reviewSteps}
            resubmit={resubmit}
            onGenerate={() => run(() => generateAiDraft(queryId, currentUser))}
            onSave={handleSave}
            onSubmit={() =>
              run(() => {
                submitForReview(queryId, currentUser, { changeSummary: changeNote });
                setChangeNote('');
              })
            }
          />
        </div>

        <div className="lg:col-span-1 space-y-6">
          <ReviewChainCard
            reviewSteps={reviewSteps}
            deleteError={deleteError}
            onDelete={handleDelete}
            can={can}
            newReviewer={newReviewer}
            onNewReviewerChange={setNewReviewer}
            onAddReviewer={() => {
              run(() => addReviewLevel(queryId, newReviewer, currentUser));
              setNewReviewer('');
            }}
          />

          <PreviousReviewCycles steps={stepHistory} />

          <VersionHistoryCard versions={versions} />
        </div>
      </div>
    </div>
  );
}
