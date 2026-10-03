import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQueryCase } from "@/hooks/useQueryCase";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useWorkflowAction } from "@/hooks/useWorkflowAction";
import { ActionError } from "@/components/workflow/ActionError";
import { WORKFLOW_ACTION } from "@/constants/workflowRules";
import { findUserById } from "@/constants/mockUsers";

export function ReviewDecisionCard() {
  const { queryId, query, currentStep, currentUser, can } = useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const approveReview = useWorkflowStore((state) => state.approveReview);
  const requestRevision = useWorkflowStore((state) => state.requestRevision);
  const [comment, setComment] = useState("");
  const requesting = comment.length > 0;

  if (!query) return null;

  const isCurrentReviewer = currentStep?.assignedUserId === currentUser?.id;
  const canDecide =
    can(WORKFLOW_ACTION.APPROVE_REVIEW) &&
    currentStep?.stepType === "REVIEW" &&
    isCurrentReviewer;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">
          Review decision
        </h2>
      </CardHeader>
      <CardBody className="space-y-3">
        <ActionError message={error} onDismiss={clearError} />

        {canDecide ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="review-comment">Request changes</Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe the changes the officer must make — leave empty to approve"
                rows={4}
                aria-describedby="review-comment-hint"
              />
            </div>
            <Button
              className="w-full"
              disabled={requesting}
              title={requesting ? "Clear the change request to approve" : undefined}
              onClick={() => {
                run(() => approveReview(queryId, "", currentUser));
                setComment("");
              }}
            >
              Approve
            </Button>
            <Button
              className="w-full bg-status-orange-fg text-white hover:bg-status-orange-fg/90 focus-visible:ring-status-orange-fg/30"
              disabled={!comment.trim()}
              onClick={() => {
                run(() => requestRevision(queryId, comment, currentUser));
                setComment("");
              }}
            >
              Request changes
            </Button>
            <p id="review-comment-hint" className="text-xs text-muted-foreground">
              {requesting
                ? "Approve is disabled while a change request is written — clear the box to approve instead."
                : "Approve if no changes are needed. To return it, describe what must change — the officer works from your request, and the review restarts at the first reviewer."}
            </p>
          </>
        ) : currentStep?.stepType === "REVIEW" && !isCurrentReviewer ? (
          <p className="rounded-md border border-status-amber-line bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
            This level is assigned to{" "}
            {findUserById(currentStep.assignedUserId)?.name}. Only they can approve it or return it for revision.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Review decisions are available to reviewers while the query is UNDER_REVIEW.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
