import { useState } from 'react';
import { SparklesIcon, Trash2Icon, Loader2 } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { findUserById } from '@/constants/mockUsers';
import { reviewLevelName } from '@/constants/queryLifecycle';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';
import { AddReviewLevelField } from '@/components/workflow/AddReviewLevelField';

const levelName = reviewLevelName;

function reviewStatusVariant(status) {
  if (status === 'COMPLETED') return 'status-green';
  if (status === 'IN_PROGRESS') return 'status-blue';
  return 'status-gray';
}

/** Why the draft came back, shown above the editor. */
function ReturnedForRevisionNotice({ review }) {
  return (
    <div className="mb-6 rounded-md border border-status-orange-line bg-status-orange-bg px-4 py-3 text-sm text-status-orange-fg">
      <p className="font-medium">Returned for revision</p>
      <p className="mt-0.5">{review.comment || 'No comment provided.'}</p>
    </div>
  );
}

/** Why "Submit for review" is unavailable, if it is. */
function submitBlockedReason(isDirty, hasReviewers) {
  if (isDirty) return 'Save your changes as a version first';
  if (!hasReviewers) return 'Add at least one review level first';
  return undefined;
}

function DraftActions({
  can,
  running,
  isDirty,
  draft,
  versions,
  reviewSteps,
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

  return (
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
        <Button
          variant="secondary"
          disabled={isDirty || reviewSteps.length === 0}
          title={submitBlockedReason(isDirty, reviewSteps.length > 0)}
          onClick={onSubmit}
        >
          Submit for review
        </Button>
      )}
    </div>
  );
}

/** The editable response, plus the actions that move it along. */
function DraftEditorCard({
  latestVersion,
  versions,
  draft,
  onDraftChange,
  can,
  running,
  isDirty,
  reviewSteps,
  onGenerate,
  onSave,
  onSubmit,
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Response draft</h2>
        {latestVersion && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Editing from {latestVersion.version} ({latestVersion.label})
          </p>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
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
          onGenerate={onGenerate}
          onSave={onSave}
          onSubmit={onSubmit}
        />

        <p className="text-xs text-muted-foreground">
          AI-generated content never becomes the final response automatically — a human must review
          and can edit it. Every save appends a new version; previous versions are never
          overwritten.
        </p>
      </CardBody>
    </Card>
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
        {step.status === 'PENDING' && (
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

/** Who reviews this response, in order, and how to change that list. */
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
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Review chain</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The response passes each level in order before it reaches the Officer-in-Charge.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {reviewSteps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviewer chosen yet — the draft cannot be submitted until you add one.
          </p>
        ) : (
          reviewSteps.map((step, index) => (
            <ReviewChainRow key={step.stepId} step={step} index={index} onDelete={onDelete} />
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
      </CardBody>
    </Card>
  );
}

function VersionHistoryCard({ versions }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Version history</h2>
      </CardHeader>
      <CardBody className="space-y-3">
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
      </CardBody>
    </Card>
  );
}

export function DraftingDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, versions, latestVersion, reviews, steps, currentUser, can } =
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
  const draft = edited ?? latestVersion?.content ?? '';

  if (!query) return <EmptyState title="Query not found" />;

  const wasReturned = query.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION;
  const latestReturn = [...reviews].reverse().find((r) => r.decision === 'CHANGES_REQUESTED');
  const isDirty = edited !== null && edited !== (latestVersion?.content ?? '');
  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');

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
      {wasReturned && latestReturn && <ReturnedForRevisionNotice review={latestReturn} />}

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
            onGenerate={() => run(() => generateAiDraft(queryId, currentUser))}
            onSave={handleSave}
            onSubmit={() => run(() => submitForReview(queryId, currentUser))}
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

          <VersionHistoryCard versions={versions} />
        </div>
      </div>
    </div>
  );
}
