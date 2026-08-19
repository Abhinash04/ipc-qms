import { Link } from 'react-router-dom';
import { PaperclipIcon } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { WorkflowActionsCard } from '@/components/workflow/WorkflowActionsCard';
import { EmailThread } from '@/components/email/EmailThread';
import { AiSummaryCard } from '@/components/ai/AiSummaryCard';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export function QueryDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, currentUser, can, steps, versions, latestVersion, audit, messages, currentStep } =
    useQueryCase();
  const canAssign = can(WORKFLOW_ACTION.ASSIGN);
  const assignQuery = useWorkflowStore((state) => state.assignQuery);

  if (!query) {
    return (
      <EmptyState
        title="Query not found"
        description={`No query matching ${queryId} exists in the current demo data.`}
      />
    );
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Queries', path: paths.QUERIES },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Workflow progress</h2>
            </CardHeader>
            <CardBody>
              <WorkflowTimeline steps={steps} currentStepId={currentStep?.stepId} />
            </CardBody>
          </Card>

          <AiSummaryCard
            summary={query.aiSummary}
            query={query}
            onSummaryUpdated={(newSummary) => {
              useWorkflowStore.getState().applyTransition({
                queryId: query.queryId,
                actor: null,
                actorLabel: 'Gemma AI Summary Assistant',
                patch: { aiSummary: newSummary },
                details: newSummary.text,
              });
            }}
          />

          <AiRecommendationCard
            query={query}
            currentAssigneeId={query.currentAssigneeId}
            onAssign={canAssign ? (officialId) => assignQuery(query.queryId, officialId, currentUser) : null}
          />

          <EmailThread messages={messages} />

          <Card className="overflow-hidden py-3">
            <Tabs defaultValue="draft">
              <div className="border-b border-border px-4">
                <TabsList variant="line">
                  <TabsTrigger value="draft">Response Draft</TabsTrigger>
                  <TabsTrigger value="info">Query Info</TabsTrigger>
                  <TabsTrigger value="attachments">Attachments</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="draft" className="mt-0 p-5">
                {versions.length === 0 ? (
                  <EmptyState
                    title="No draft yet"
                    description="The assigned official has not started drafting a response."
                  />
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Versions: {versions.map((v) => v.version).join(' → ')} — showing{' '}
                      <span className="font-medium text-foreground">{latestVersion.version}</span> (
                      {latestVersion.label})
                    </p>
                    <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                      {latestVersion.content}
                    </pre>
                  </>
                )}
              </TabsContent>

              <TabsContent value="info" className="mt-0 p-5">
                <InfoRow label="Inquirer" value={query.inquirer.name} />
                <InfoRow label="Source" value={query.source} />
                <InfoRow label="Category" value={query.category} />
                <InfoRow label="Created" value={new Date(query.createdAt).toLocaleDateString()} />
                <p className="mt-3 text-sm text-muted-foreground">{query.description}</p>
              </TabsContent>

              <TabsContent value="attachments" className="mt-0 p-5">
                {query.attachments.length === 0 ? (
                  <EmptyState icon={PaperclipIcon} title="No attachments" />
                ) : (
                  <ul className="space-y-2">
                    {query.attachments.map((att) => (
                      <li
                        key={att.id}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <PaperclipIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1 text-foreground">{att.name}</span>
                        <span className="text-xs text-muted-foreground">{att.sizeKb} KB</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <WorkflowActionsCard />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">Audit history</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Append-only — {audit.length} event{audit.length === 1 ? '' : 's'} recorded.
          </p>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((entry) => (
                <TableRow key={entry.auditId}>
                  <TableCell className="text-foreground">{entry.event.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.actor}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                    {entry.details || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Stage-specific actions also live on their dedicated pages —{' '}
        <Link to={paths.ASSIGNMENTS} className="text-ring hover:underline">
          Assignments
        </Link>
        ,{' '}
        <Link to={paths.DRAFTING} className="text-ring hover:underline">
          Drafting
        </Link>
        ,{' '}
        <Link to={paths.REVIEWS} className="text-ring hover:underline">
          Reviews
        </Link>
        ,{' '}
        <Link to={paths.APPROVALS} className="text-ring hover:underline">
          Approvals
        </Link>
        ,{' '}
        <Link to={paths.DISPATCH} className="text-ring hover:underline">
          Dispatch
        </Link>
        .
      </p>
    </div>
  );
}
