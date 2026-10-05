import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DecisionCommentDialog } from "@/components/workflow/DecisionCommentDialog";
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
  // Which decision's dialog is open: "approve", "changes" or none.
  const [deciding, setDeciding] = useState(null);
  const openDialog = (decision) => {
    clearError();
    setDeciding(decision);
  };
  const dialogProps = (decision) => ({
    open: deciding === decision,
    onOpenChange: (open) => setDeciding(open ? decision : null),
    error: deciding === decision ? error : null,
  });

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
            <Button className="w-full" onClick={() => openDialog("approve")}>
              Approve
            </Button>
            <Button
              className="w-full bg-status-orange-fg text-white hover:bg-status-orange-fg/90 focus-visible:ring-status-orange-fg/30"
              onClick={() => openDialog("changes")}
            >
              Request changes
            </Button>
            <p className="text-xs text-muted-foreground">
              Approve if no changes are needed, with remarks if you wish. Request changes returns it to the officer
              with your comments, and the review restarts at the first reviewer.
            </p>

            <DecisionCommentDialog
              {...dialogProps("approve")}
              title="Approve review"
              description="The response moves to the next review level, or to final approval."
              label="Approval remarks (optional)"
              placeholder="Reviewed and approved. The response is accurate and can proceed to the next stage."
              confirmLabel="Approve"
              onSubmit={(comment) => run(() => approveReview(queryId, comment, currentUser))}
            />
            <DecisionCommentDialog
              {...dialogProps("changes")}
              title="Request changes"
              description="The response goes back to the assigned officer, who works from your comments."
              label="Changes required"
              placeholder="Please revise the response to include the relevant reference standards and provide more details regarding the testing methodology."
              required
              confirmLabel="Request changes"
              tone="change"
              onSubmit={(comment) => run(() => requestRevision(queryId, comment, currentUser))}
            />
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
