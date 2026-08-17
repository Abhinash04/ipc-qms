import { Breadcrumb } from '@/components/common/Breadcrumb';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ReviewDetailPage() {
  const query = MOCK_QUERY;
  const currentStep = query.workflowSteps.find((step) => step.stepId === query.currentWorkflowStepId);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Reviews', path: ROUTE_PATHS.REVIEWS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Workflow progress</h2>
              {currentStep && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  You're reviewing at sequence {currentStep.sequence} ({currentStep.stepType.replace(/_/g, ' ')}).
                </p>
              )}
            </CardHeader>
            <CardBody>
              <WorkflowTimeline steps={query.workflowSteps} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Draft under review</h2>
            </CardHeader>
            <CardBody>
              <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                {query.currentDraft}
              </pre>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Review decision</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="review-comment">Comments</Label>
                <Textarea id="review-comment" placeholder="Add a comment for the assigned official…" rows={4} disabled />
              </div>
              <Button className="w-full" disabled>
                Approve
              </Button>
              <Button variant="secondary" className="w-full" disabled>
                Return for revision
              </Button>
              <p className="text-xs text-muted-foreground">Review decisions aren't wired up yet.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
