import { useState } from 'react';
import SparklesIcon from 'lucide-react/dist/esm/icons/sparkles.mjs';

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
import { ROUTE_PATHS } from '@/constants/routePaths';

export function DraftingDetailPage() {
  const { queryId, query, versions, latestVersion, reviews, currentUser, can } = useQueryCase();
  const generateAiDraft = useWorkflowStore((state) => state.generateAiDraft);
  const saveDraftVersion = useWorkflowStore((state) => state.saveDraftVersion);
  const submitForReview = useWorkflowStore((state) => state.submitForReview);
  const [edited, setEdited] = useState(null);
  const draft = edited ?? latestVersion?.content ?? '';

  if (!query) return <EmptyState title="Query not found" />;

  const wasReturned = query.workflowState === WORKFLOW_STATE.RETURNED_FOR_REVISION;
  const latestReturn = [...reviews].reverse().find((r) => r.decision === 'CHANGES_REQUESTED');
  const isDirty = edited !== null && edited !== (latestVersion?.content ?? '');

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Drafting', path: ROUTE_PATHS.DRAFTING },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

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
                    <Button variant="secondary" onClick={() => generateAiDraft(queryId, currentUser)}>
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
                      setEdited(null); // snap back to mirroring the newly saved version
                    }}
                  >
                    Save new version
                  </Button>
                  {can(WORKFLOW_ACTION.SUBMIT_FOR_REVIEW) && versions.length > 0 && (
                    <Button
                      variant="secondary"
                      disabled={isDirty}
                      title={isDirty ? 'Save your changes as a version first' : undefined}
                      onClick={() => submitForReview(queryId, currentUser)}
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

        <div className="lg:col-span-1">
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
