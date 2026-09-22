import { useState } from "react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { EmptyState } from "@/components/common/EmptyState";
import { CaseSummaryBar } from "@/components/workflow/CaseSummaryBar";
import { QueryLifecycleTimeline } from "@/components/workflow/QueryLifecycleTimeline";
import { buildLifecycle } from "@/constants/queryLifecycle";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQueryCase } from "@/hooks/useQueryCase";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { WORKFLOW_ACTION } from "@/constants/workflowRules";
import { findUserById } from "@/constants/mockUsers";
import { useRoutePaths } from "@/hooks/useRoutePaths";
import { useWorkflowAction } from "@/hooks/useWorkflowAction";
import { ActionError } from "@/components/workflow/ActionError";
import { notify } from "@/services/notify";

export function ApprovalDetailPage() {
  const paths = useRoutePaths();
  const {
    queryId,
    query,
    steps,
    reviews,
    versions,
    latestVersion,
    audit,
    messages,
    currentUser,
    can,
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
  const [comment, setComment] = useState("");

  if (!query) return <EmptyState title="Query not found" />;

  const canApprove = can(WORKFLOW_ACTION.FINAL_APPROVE);

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
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">
                Review history
              </h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <QueryLifecycleTimeline
                stages={buildLifecycle({
                  query,
                  steps,
                  versions,
                  reviews,
                  audit,
                  messages,
                })}
              />
              {reviews.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {reviews.map((r) => (
                    <div key={r.reviewId} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            r.decision === "APPROVED"
                              ? "status-green"
                              : "status-orange"
                          }
                        >
                          {r.decision.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-foreground">
                          {findUserById(r.reviewerId)?.name || "Unknown"}
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">
                Final draft
              </h2>
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
              <h2 className="text-sm font-semibold text-foreground">
                Final approval decision
              </h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {canApprove ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="approval-comment">
                      Comments (optional)
                    </Label>
                    <Textarea
                      id="approval-comment"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                    />
                  </div>
                  {/* Disabled while it runs. A send can take twenty seconds on
                      a bad network, and a button that still looks ready is an
                      invitation to press it again: four presses during one slow
                      send is how an inquirer received the same response three
                      times. */}
                  <Button
                    className="w-full"
                    disabled={running}
                    onClick={() =>
                      run(async () => {
                        const result = await grantFinalApproval(
                          queryId,
                          currentUser,
                          undefined,
                          { comment },
                        );
                        setComment("");

                        /**
                         * Approving and answering are one click but two
                         * outcomes, and the second can fail on its own. Saying
                         * only "approved" when the inquirer was never emailed
                         * is the state this whole change exists to prevent, so
                         * anything short of a send is raised here — the
                         * approval stands either way, and the case waits at
                         * READY_FOR_DISPATCH for the Front Office to retry.
                         */
                        if (result?.inProgress) {
                          notify.info(
                            "Already being sent",
                            `${queryId} is being sent by another request. This page will show the result shortly.`,
                          );
                          return result;
                        }

                        if (!result?.dispatched && !result?.alreadyDispatched) {
                          const failure = result?.errors?.[0];
                          const reason =
                            failure?.error || "the response could not be sent";

                          // "May have been sent" and "was not sent" need
                          // opposite instructions: one says check before you
                          // retry, the other says retry.
                          throw new Error(
                            failure?.unconfirmed
                              ? `Approved, and the response may already have been sent: ${reason}`
                              : `Approved, but the inquirer was not emailed: ${reason}`,
                          );
                        }

                        return result;
                      })
                    }
                  >
                    {running ? "Approving and sending…" : "Approve"}
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={running || !comment.trim()}
                    onClick={() => {
                      run(() =>
                        returnForRevision(queryId, comment, currentUser),
                      );
                      setComment("");
                    }}
                  >
                    Return for revision
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A comment is required. Returning restarts the full review
                    cycle — the revised response passes Reviewer-I and
                    Reviewer-II again before returning here.
                  </p>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={running}
                    onClick={() => {
                      run(() =>
                        rejectFinalApproval(queryId, comment, currentUser),
                      );
                      setComment("");
                    }}
                  >
                    Reject
                  </Button>
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
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
