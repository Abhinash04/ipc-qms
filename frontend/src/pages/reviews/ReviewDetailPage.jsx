import { useState } from 'react';
import {
  CircleCheckBig,
  ClipboardCheck,
  Eye,
  FileSearch,
  FileText,
  Flag,
  Layers,
  ListChecks,
  MessageSquareText,
  Milestone,
  Route,
  Trash2Icon,
} from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseCard } from '@/components/common/CaseCard';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { QueryLifecycleTimeline } from '@/components/workflow/QueryLifecycleTimeline';
import { buildLifecycle, STAGE_STATUS } from '@/constants/queryLifecycle';
import { buildSpecialEvents } from '@/constants/workflowExceptions';
import { Button } from '@/components/ui/button';
import { ReviewDecisionCard } from '@/components/workflow/ReviewDecisionCard';
import { Badge } from '@/components/ui/badge';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { findUserById } from '@/constants/mockUsers';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';
import { AddReviewLevelField } from '@/components/workflow/AddReviewLevelField';
import { PreviousReviewCycles } from '@/components/workflow/PreviousReviewCycles';
import { ResubmissionCard } from '@/components/workflow/ResubmissionCard';
import { DECISION_LABEL, DECISION_VARIANT, isSendBack, requesterRole } from '@/constants/reviewRounds';
import { formatDateTime } from '@/utils/dateTime';

export function ReviewDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, steps, stepHistory, currentStep, reviews, versions, latestVersion, audit, messages, currentUser, can, resolving } =
    useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const addReviewLevel = useWorkflowStore((state) => state.addReviewLevel);
  const deleteReviewLevel = useWorkflowStore((state) => state.deleteReviewLevel);

  const [newReviewer, setNewReviewer] = useState('');
  const [deleteError, setDeleteError] = useState(null);

  if (!query) return <EmptyState title={resolving ? 'Loading case…' : 'Query not found'} />;

  const reviewSteps = steps.filter((s) => s.stepType === 'REVIEW');
  const stages = buildLifecycle({ query, steps, versions, reviews, audit, messages });
  const specialEvents = buildSpecialEvents({ query, audit });
  const completedStages = stages.filter((stage) => stage.status === STAGE_STATUS.COMPLETE).length;
  const roundOf = (review) =>
    1 + reviews.filter((r) => isSendBack(r) && String(r.at) < String(review.at)).length;

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
          <CaseCard
            tone="progress"
            banner
            art={[Milestone, Flag, CircleCheckBig]}
            icon={Route}
            title="Workflow progress"
            meta={`${completedStages} of ${stages.length} stages complete${
              specialEvents.length ? ` · ${specialEvents.length} pull backs & transfers` : ''
            }`}
            bodyClassName="py-5"
          >
            <QueryLifecycleTimeline stages={stages} events={specialEvents} audit={audit} />
          </CaseCard>

          <ResubmissionCard
            query={query}
            reviews={reviews}
            versions={versions}
            steps={[...steps, ...(stepHistory || [])]}
            latestVersion={latestVersion}
            currentStep={currentStep}
          />

          <CaseCard
            tone="document"
            banner
            art={[FileSearch, FileText, Eye]}
            icon={FileText}
            title="Draft under review"
            meta={latestVersion ? `${latestVersion.version} — ${latestVersion.label}` : undefined}
          >
            {latestVersion ? (
              <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                {latestVersion.content}
              </pre>
            ) : (
              <EmptyState title="No draft submitted yet" />
            )}
          </CaseCard>

          {reviews.length > 0 && (
            <CaseCard
              banner
              art={[ClipboardCheck, MessageSquareText, ListChecks]}
              icon={ClipboardCheck}
              title="Review decisions"
              meta={`${reviews.length} ${reviews.length === 1 ? 'decision' : 'decisions'}`}
              bodyClassName="space-y-3"
            >
              {reviews.map((r) => (
                <div key={r.reviewId} className="border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={DECISION_VARIANT[r.decision] || 'status-gray'}>
                      {DECISION_LABEL[r.decision] || r.decision}
                    </Badge>
                    <span className="text-foreground">{findUserById(r.reviewerId)?.name || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">
                      {requesterRole(r, [...steps, ...(stepHistory || [])])}
                    </span>
                    {r.version && (
                      <Badge variant="outline" title="The response version this decision was made against">
                        {r.version}
                      </Badge>
                    )}
                    <Badge variant="outline" title="Review round — a new round starts after each change request">
                      Round {roundOf(r)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.at)}</span>
                  </div>
                  {r.comment && <p className="mt-1 text-muted-foreground">{r.comment}</p>}
                </div>
              ))}
            </CaseCard>
          )}
        </div>

        <div className="space-y-6 lg:col-span-1">
          <ReviewDecisionCard />

          <CaseCard
            banner
            compact
            art={[ListChecks]}
            icon={Layers}
            title="Review levels"
            meta="Levels are dynamic — add as many as the query needs."
            bodyClassName="space-y-3"
          >
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
                    {step.status === 'PENDING' && can(WORKFLOW_ACTION.DELETE_REVIEW_LEVEL) && (
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
              <AddReviewLevelField
                label={"Add a review level"}
                value={newReviewer}
                onChange={setNewReviewer}
                onAdd={() => {
                  run(() => addReviewLevel(queryId, newReviewer, currentUser));
                  setNewReviewer('');
                }}
              />
            )}

            <p className="text-xs text-muted-foreground">
              Only a PENDING level can be deleted — a completed review's decision is part of the audit trail. Only the assigned official can add or delete levels.
            </p>
          </CaseCard>

          <PreviousReviewCycles steps={stepHistory} />
        </div>
      </div>
    </div>
  );
}
