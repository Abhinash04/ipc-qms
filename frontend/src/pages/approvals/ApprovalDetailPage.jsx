import { useState } from "react";
import { CircleCheckBig, FileCheck, FileSignature, Flag, Gavel, Milestone, Route, Stamp } from "lucide-react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { EmptyState } from "@/components/common/EmptyState";
import { CaseCard } from "@/components/common/CaseCard";
import { CaseSummaryBar } from "@/components/workflow/CaseSummaryBar";
import { QueryLifecycleTimeline } from "@/components/workflow/QueryLifecycleTimeline";
import { buildLifecycle, STAGE_STATUS } from "@/constants/queryLifecycle";
import { buildSpecialEvents } from "@/constants/workflowExceptions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryCase } from "@/hooks/useQueryCase";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { WORKFLOW_ACTION } from "@/constants/workflowRules";
import { findUserById } from "@/constants/mockUsers";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useWorkflowAction } from "@/hooks/useWorkflowAction";
import { ActionError } from "@/components/workflow/ActionError";
import { ResubmissionCard } from "@/components/workflow/ResubmissionCard";
import { DecisionCommentDialog } from "@/components/workflow/DecisionCommentDialog";
import { DECISION_LABEL, DECISION_VARIANT, requesterRole } from "@/constants/reviewRounds";
import { formatDateTime } from "@/utils/dateTime";
import { notify } from "@/services/notify";

export function ApprovalDetailPage() {
  const paths = useRoutePaths();
  const {
    queryId,
    query,
    steps,
    stepHistory,
    currentStep,
    reviews,
    versions,
    latestVersion,
    audit,
    messages,
    currentUser,
    can,
    resolving,
  } = useQueryCase();
  const { run, running, error, clearError } = useWorkflowAction();
  const grantFinalApproval = useWorkflowStore(
    (state) => state.grantFinalApproval,
  );
  const rejectFinalApproval = useWorkflowStore(
    (state) => state.rejectFinalApproval,
  );
  const returnForRevision = useWorkflowStore(
    (state) => state.returnForRevisionFromApproval,
  );
  // Which decision's dialog is open: "approve", "return", "reject" or none.
  const [deciding, setDeciding] = useState(null);

  if (!query) return <EmptyState title={resolving ? "Loading case…" : "Query not found"} />;

  const canApprove = can(WORKFLOW_ACTION.FINAL_APPROVE);
  const stages = buildLifecycle({ query, steps, versions, reviews, audit, messages });
  const specialEvents = buildSpecialEvents({ query, audit });
  const completedStages = stages.filter((stage) => stage.status === STAGE_STATUS.COMPLETE).length;
  const openDialog = (decision) => {
    clearError();
    setDeciding(decision);
  };
  const dialogProps = (decision) => ({
    open: deciding === decision,
    onOpenChange: (open) => setDeciding(open ? decision : null),
    error: deciding === decision ? error : null,
  });

  // Approves and sends. Once approved, the dialog closes even if the email then failed: that is
  // reported on the page, and approving again would not help.
  const approve = async (comment) => {
    let approved = false;
    const ok = await run(async () => {
      const result = await grantFinalApproval(queryId, currentUser, undefined, { comment });
      approved = true;

      if (result?.inProgress) {
        notify.info(
          "Already being sent",
          `${queryId} is being sent by another request. This page will show the result shortly.`,
        );
        return result;
      }

      if (!result?.dispatched && !result?.alreadyDispatched) {
        const failure = result?.errors?.[0];
        const reason = failure?.error || "the response could not be sent";

        throw new Error(
          failure?.unconfirmed
            ? `Approved, and the response may already have been sent: ${reason}`
            : `Approved, but the inquirer was not emailed: ${reason}`,
        );
      }

      return result;
    });
    return ok || approved;
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", path: paths.DASHBOARD },
          { label: "Approvals", path: paths.APPROVALS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <ActionError message={error} onDismiss={clearError} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ResubmissionCard
            query={query}
            reviews={reviews}
            versions={versions}
            steps={[...steps, ...(stepHistory || [])]}
            latestVersion={latestVersion}
            currentStep={currentStep}
          />

          <CaseCard
            tone="progress"
            banner
            art={[Milestone, Flag, CircleCheckBig]}
            icon={Route}
            title="Review history"
            meta={`${completedStages} of ${stages.length} stages complete${
              specialEvents.length ? ` · ${specialEvents.length} pull backs & transfers` : ""
            }`}
            bodyClassName="space-y-4 py-5"
          >
            <QueryLifecycleTimeline stages={stages} events={specialEvents} audit={audit} />
            {reviews.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {reviews.map((r) => (
                  <div key={r.reviewId} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={DECISION_VARIANT[r.decision] || "status-gray"}>
                        {DECISION_LABEL[r.decision] || r.decision}
                      </Badge>
                      <span className="text-foreground">
                        {findUserById(r.reviewerId)?.name || "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {requesterRole(r, [...steps, ...(stepHistory || [])])}
                        {r.version ? ` · ${r.version}` : ""} · {formatDateTime(r.at)}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="mt-0.5 text-muted-foreground">
                        {r.comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CaseCard>

          <CaseCard
            tone="document"
            banner
            art={[FileSignature, FileCheck, Stamp]}
            icon={FileCheck}
            title="Final draft"
            meta={latestVersion ? `${latestVersion.version} — ${latestVersion.label}` : undefined}
          >
            {latestVersion ? (
              <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                {latestVersion.content}
              </pre>
            ) : (
              <EmptyState title="No draft to approve yet" />
            )}
          </CaseCard>
        </div>

        <div className="lg:col-span-1">
          <CaseCard
            tone="action"
            banner
            compact
            art={[Gavel]}
            icon={Stamp}
            title="Final approval decision"
            bodyClassName="space-y-3"
          >
            {canApprove ? (
              <>
                <Button className="w-full" disabled={running} onClick={() => openDialog("approve")}>
                  {running && deciding === "approve" ? "Approving and sending…" : "Approve"}
                </Button>
                <Button
                  className="w-full bg-status-orange-fg text-white hover:bg-status-orange-fg/90 focus-visible:ring-status-orange-fg/30"
                  disabled={running}
                  onClick={() => openDialog("return")}
                >
                  Return for revision
                </Button>
                <Button variant="destructive" className="w-full" disabled={running} onClick={() => openDialog("reject")}>
                  Reject
                </Button>
                <p className="text-xs text-muted-foreground">
                  Approve sends the response to the inquirer and closes the query. Returning restarts the full review
                  cycle before it comes back here.
                </p>

                <DecisionCommentDialog
                  {...dialogProps("approve")}
                  title="Give final approval"
                  description={`${latestVersion?.version || "The response"} is locked and emailed to the inquirer, and the query is closed.`}
                  label="Approval remarks (optional)"
                  placeholder="Reviewed and approved. The response is accurate and can proceed to the next stage."
                  confirmLabel="Approve and send"
                  onSubmit={approve}
                />
                <DecisionCommentDialog
                  {...dialogProps("return")}
                  title="Return for revision"
                  description="The response goes back to the assigned officer, and the full review cycle restarts."
                  label="Changes required"
                  placeholder="Please revise the response to include the relevant reference standards and provide more details regarding the testing methodology."
                  required
                  confirmLabel="Return for revision"
                  tone="change"
                  onSubmit={(comment) => run(() => returnForRevision(queryId, comment, currentUser))}
                />
                <DecisionCommentDialog
                  {...dialogProps("reject")}
                  title={`Reject ${latestVersion?.version || "this response"}?`}
                  description="The reason is recorded and sent back to the assigned official."
                  label="Reason for rejecting"
                  placeholder="State why the response cannot be approved."
                  required
                  confirmLabel="Reject"
                  tone="reject"
                  onSubmit={(comment) => run(() => rejectFinalApproval(queryId, comment, currentUser))}
                />
                <p className="text-xs text-muted-foreground">
                  Whether the OIC may directly edit the response at this stage
                  is a client clarification item — editing is not offered
                  here.
                </p>
              </>
            ) : (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Final approval is available to the Officer-in-Charge once all
                review levels are complete and the query reaches
                PENDING_FINAL_APPROVAL.
              </p>
            )}
          </CaseCard>
        </div>
      </div>
    </div>
  );
}
