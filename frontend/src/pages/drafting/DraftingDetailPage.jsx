import { useState } from 'react';
import { SparklesIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { reviewLevelName } from '@/constants/queryLifecycle';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';

const ELIGIBLE_REVIEWERS = MOCK_USERS.filter((u) => u.role === ROLES.REVIEWER);
const levelName = reviewLevelName;

export function DraftingDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, versions, latestVersion, reviews, steps, currentUser, can } =
    useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
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
        <div className="mb-6 rounded-md border border-status-orange-line bg-status-orange-bg px-4 py-3 text-sm text-status-orange-fg">
          <p className="font-medium">Returned for revision</p>
          <p className="mt-0.5">{latestReturn.comment || 'No comment provided.'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
                  onChange={(e) => setEdited(e.target.value)}
                  rows={14}
                  className="resize-none"
                  disabled={!can(WORKFLOW_ACTION.SAVE_DRAFT)}
                />
              )}

              {can(WORKFLOW_ACTION.SAVE_DRAFT) ? (
                <div className="flex flex-wrap gap-2">
                  {can(WORKFLOW_ACTION.GENERATE_AI_DRAFT) && (
                    <Button variant="secondary" onClick={() => run(() => generateAiDraft(queryId, currentUser))}>
                      <SparklesIcon className="h-4 w-4" aria-hidden="true" />
                      Generate AI draft
                    </Button>
                  )}
                  <Button
                    disabled={!isDirty || !draft.trim()}
                    onClick={() => {
                      saveDraftVersion(
                        queryId,
                        draft,
                        currentUser,
                        wasReturned ? 'Reviewer requested revision' : 'Officer revision',
                      );
                      setEdited(null);
                    }}
                  >
                    Save new version
                  </Button>
                  {can(WORKFLOW_ACTION.SUBMIT_FOR_REVIEW) && versions.length > 0 && (
                    <Button
                      variant="secondary"
                      disabled={isDirty || reviewSteps.length === 0}
                      title={
                        isDirty
                          ? 'Save your changes as a version first'
                          : reviewSteps.length === 0
                            ? 'Add at least one review level first'
                            : undefined
                      }
                      onClick={() => run(() => submitForReview(queryId, currentUser))}
                    >
                      Submit for review
                    </Button>
                  )}
                </div>
              ) : (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Drafting is available to the assigned official while the query is in ASSIGNED,
                  DRAFTING, or RETURNED_FOR_REVISION.
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                AI-generated content never becomes the final response automatically — a human must
                review and can edit it. Every save appends a new version; previous versions are
                never overwritten.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
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
                  <div
                    key={step.stepId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{levelName(index)}</p>
                      <p className="text-xs text-muted-foreground">
                        {findUserById(step.assignedUserId)?.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={
                          step.status === 'COMPLETED'
                            ? 'status-green'
                            : step.status === 'IN_PROGRESS'
                              ? 'status-blue'
                              : 'status-gray'
                        }
                      >
                        {step.status}
                      </Badge>
                      {step.status === 'PENDING' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${levelName(index)}`}
                          onClick={() => handleDelete(step.stepId)}
                        >
                          <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}

              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

              {can(WORKFLOW_ACTION.ADD_REVIEW_LEVEL) && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Label htmlFor="new-reviewer">Add {levelName(reviewSteps.length)}</Label>
                  <div className="flex gap-2">
                    <Select id="new-reviewer" value={newReviewer} onValueChange={setNewReviewer}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select reviewer" />
                      </SelectTrigger>
                      <SelectContent>
                        {ELIGIBLE_REVIEWERS.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="secondary"
                      disabled={!newReviewer}
                      onClick={() => {
                        run(() => addReviewLevel(queryId, newReviewer, currentUser));
                        setNewReviewer('');
                      }}
                    >
                      <PlusIcon className="h-4 w-4" aria-hidden="true" />
                      Add
                    </Button>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                If a reviewer requests changes the response comes back to you for a new version, and
                the chain restarts at {levelName(0)}.
              </p>
            </CardBody>
          </Card>

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
        </div>
      </div>
    </div>
  );
}
