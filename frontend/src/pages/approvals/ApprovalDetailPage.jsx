import { Breadcrumb } from '@/components/common/Breadcrumb';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function ApprovalDetailPage() {
  const query = MOCK_QUERY;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Approvals', path: ROUTE_PATHS.APPROVALS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Review history</h2>
            </CardHeader>
            <CardBody>
              <WorkflowTimeline steps={query.workflowSteps} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Final draft</h2>
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
              <h2 className="text-sm font-semibold text-foreground">Final approval decision</h2>
            </CardHeader>
            <CardBody className="space-y-2">
              <Button className="w-full" disabled>
                Approve
              </Button>
              <Button variant="secondary" className="w-full" disabled>
                Return for revision
              </Button>
              <Button variant="destructive" className="w-full" disabled>
                Reject
              </Button>
              <p className="pt-1 text-xs text-muted-foreground">Approval decisions aren't wired up yet.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
