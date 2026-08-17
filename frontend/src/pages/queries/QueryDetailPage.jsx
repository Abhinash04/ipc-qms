import PaperclipIcon from 'lucide-react/dist/esm/icons/paperclip.mjs';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { RoleGate } from '@/components/common/RoleGate';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { WorkflowTimeline } from '@/components/workflow/WorkflowTimeline';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';
import { ROLES } from '@/constants/roles';

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

const ACTIONS = [
  { allow: [ROLES.OFFICER_IN_CHARGE, ROLES.SUPER_ADMIN], label: 'Assign query', variant: 'primary' },
  { allow: [ROLES.ASSIGNED_OFFICIAL, ROLES.SUPER_ADMIN], label: 'Edit draft', variant: 'secondary' },
  { allow: [ROLES.REVIEWER, ROLES.SUPER_ADMIN], label: 'Submit review decision', variant: 'secondary' },
  { allow: [ROLES.OFFICER_IN_CHARGE, ROLES.SUPER_ADMIN], label: 'Grant final approval', variant: 'secondary' },
  { allow: [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN], label: 'Dispatch response', variant: 'secondary' },
];

export function QueryDetailPage() {
  const query = MOCK_QUERY;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Queries', path: ROUTE_PATHS.QUERIES },
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
              <WorkflowTimeline steps={query.workflowSteps} />
            </CardBody>
          </Card>

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
                <p className="mb-3 text-xs text-muted-foreground">
                  Versions: {query.responseVersions.map((v) => v.version).join(' → ')}
                </p>
                <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                  {query.currentDraft}
                </pre>
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
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Available actions</h2>
            </CardHeader>
            <CardBody className="space-y-2">
              {ACTIONS.map((action) => (
                <RoleGate key={action.label} allow={action.allow}>
                  <Button className="w-full" variant={action.variant} disabled>
                    {action.label}
                  </Button>
                </RoleGate>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Workflow actions aren't implemented yet — see docs/srs/14-open-questions-and-client-clarifications.md.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground">Audit history</h2>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.auditHistory.map((entry, index) => (
                <TableRow key={`${entry.event}-${index}`}>
                  <TableCell className="text-foreground">{entry.event.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.actor}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
