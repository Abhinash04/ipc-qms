import { useState } from 'react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { findUserById } from '@/constants/mockUsers';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';

export function ApprovalDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, steps, reviews, latestVersion, currentStep, currentUser, can } = useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const grantFinalApproval = useWorkflowStore((state) => state.grantFinalApproval);
  const rejectFinalApproval = useWorkflowStore((state) => state.rejectFinalApproval);
  const returnForRevision = useWorkflowStore((state) => state.returnForRevisionFromApproval);
  const [comment, setComment] = useState('');

  if (!query) return <EmptyState title="Query not found" />;

  const canApprove = can(WORKFLOW_ACTION.FINAL_APPROVE);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Approvals', path: paths.APPROVALS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />



      <ActionError message={error} onDismiss={clearError} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Review history</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <WorkflowTimeline steps={steps} currentStepId={currentStep?.stepId} />
              {reviews.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {reviews.map((r) => (
                    <div key={r.reviewId} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={r.decision === 'APPROVED' ? 'status-green' : 'status-orange'}>
                          {r.decision.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-foreground">
                          {findUserById(r.reviewerId)?.name || 'Unknown'}
                        </span>
                      </div>
                      {r.comment && <p className="mt-0.5 text-muted-foreground">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Final draft</h2>
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
                <EmptyState title="No draft to approve yet" />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Final approval decision</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {canApprove ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="approval-comment">Comments (optional)</Label>
                    <Textarea
                      id="approval-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button className="w-full" onClick={() => run(() => grantFinalApproval(queryId, currentUser))}>
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={!comment.trim()}
                    onClick={() => {
                      // Wrapped, like every other action: returning without a
                      // comment throws, and an uncaught throw blanks the page.
                      run(() => returnForRevision(queryId, comment, currentUser));
                      setComment('');
                    }}
                  >
                    Return for revision
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A comment is required. Returning restarts the full review cycle — the revised
                    response passes Reviewer-I and Reviewer-II again before returning here.
                  </p>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => {
                      run(() => rejectFinalApproval(queryId, comment, currentUser));
                      setComment('');
                    }}
                  >
                    Reject
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Whether the OIC may directly edit the response at this stage is a client
                    clarification item — editing is not offered here.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Final approval is available to the Officer-in-Charge once all review levels are
                  complete and the query reaches PENDING_FINAL_APPROVAL.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
