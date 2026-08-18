import { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';

const ELIGIBLE_REVIEWERS = MOCK_USERS.filter((u) => u.role === ROLES.REVIEWER);

export function ReviewDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, steps, reviews, latestVersion, currentStep, currentUser, can } = useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const approveReview = useWorkflowStore((state) => state.approveReview);
  const requestRevision = useWorkflowStore((state) => state.requestRevision);
  const addReviewLevel = useWorkflowStore((state) => state.addReviewLevel);
  const deleteReviewLevel = useWorkflowStore((state) => state.deleteReviewLevel);

  const [comment, setComment] = useState('');
  const [newReviewer, setNewReviewer] = useState('');
  const [deleteError, setDeleteError] = useState(null);

  if (!query) return <EmptyState title="Query not found" />;

  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const isCurrentReviewer = currentStep?.assignedUserId === currentUser?.id;
  const canDecide = can(WORKFLOW_ACTION.APPROVE_REVIEW) && currentStep?.stepType === 'REVIEW';

  const handleDelete = (stepId) => {
    const result = deleteReviewLevel(queryId, stepId, currentUser);
    setDeleteError(result?.ok ? null : result?.reason || 'Could not delete this review level.');
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Reviews', path: paths.REVIEWS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />



      <ActionError message={error} onDismiss={clearError} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Workflow progress</h2>
              {currentStep?.stepType === 'REVIEW' && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Currently at review level {reviewSteps.findIndex((s) => s.stepId === currentStep.stepId) + 1} of{' '}
                  {reviewSteps.length} — {findUserById(currentStep.assignedUserId)?.name}
                </p>
              )}
            </CardHeader>
            <CardBody>
              <WorkflowTimeline steps={steps} currentStepId={currentStep?.stepId} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Draft under review</h2>
              {latestVersion && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {latestVersion.version} — {latestVersion.label}
                </p>
              )}
            </CardHeader>
            <CardBody>
              {latestVersion ? (
                <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                  {latestVersion.content}
                </pre>
              ) : (
                <EmptyState title="No draft submitted yet" />
              )}
            </CardBody>
          </Card>

          {reviews.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-foreground">Review decisions</h2>
              </CardHeader>
              <CardBody className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.reviewId} className="border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={r.decision === 'APPROVED' ? 'status-green' : 'status-orange'}>
                        {r.decision.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-foreground">{findUserById(r.reviewerId)?.name || 'Unknown'}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.at).toLocaleString()}
                      </span>
                    </div>
                    {r.comment && <p className="mt-1 text-muted-foreground">{r.comment}</p>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Review decision</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {canDecide ? (
                <>
                  {!isCurrentReviewer && (
                    <p className="rounded-md border border-status-amber-line bg-status-amber-bg px-3 py-2 text-xs text-status-amber-fg">
                      This level is assigned to {findUserById(currentStep.assignedUserId)?.name}. You're
                      acting as a different reviewer.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="review-comment">Comments</Label>
                    <Textarea
                      id="review-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Add a comment for the assigned official…"
                      rows={4}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      run(() => approveReview(queryId, comment, currentUser));
                      setComment('');
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      run(() => requestRevision(queryId, comment, currentUser));
                      setComment('');
                    }}
                  >
                    Return for revision
                  </Button>
                </>
              ) : (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Review decisions are available to reviewers while the query is UNDER_REVIEW.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Review levels</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Levels are dynamic — add as many as the query needs.
              </p>
            </CardHeader>
            <CardBody className="space-y-3">
              {reviewSteps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No review levels configured yet.</p>
              ) : (
                reviewSteps.map((step, index) => (
                  <div
                    key={step.stepId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">Level {index + 1}</p>
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
                          aria-label={`Delete review level ${index + 1}`}
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
                  <Label htmlFor="new-reviewer">Add a review level</Label>
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
                Only a PENDING level can be deleted — a completed review's decision is part of the audit trail. Who may add or delete levels is a client clarification item.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
