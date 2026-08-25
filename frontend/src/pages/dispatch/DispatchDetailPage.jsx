import {MailIcon, PaperclipIcon, SendIcon} from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EMAIL_TYPE } from '@/constants/emailModel';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';

export function DispatchDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, latestVersion, messages, currentUser, can } = useQueryCase();
  const dispatched = messages.find((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE);
  const { run, error, clearError } = useWorkflowAction();
  const dispatchResponse = useWorkflowStore((state) => state.dispatchResponse);

  if (!query) return <EmptyState title="Query not found" />;

  const canDispatch = can(WORKFLOW_ACTION.DISPATCH);
  const isClosed = query.workflowState === WORKFLOW_STATE.CLOSED;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Dispatch', path: paths.DISPATCH },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <ActionError message={error} onDismiss={clearError} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Final response preview</h2>
              {latestVersion && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {latestVersion.version} — approved and locked
                </p>
              )}
            </CardHeader>
            <CardBody>
              {latestVersion ? (
                <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                  {latestVersion.content}
                </pre>
              ) : (
                <EmptyState title="No approved response yet" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Attachments</h2>
            </CardHeader>
            <CardBody>
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
              <p className="mt-3 text-xs text-muted-foreground">
                Whether attachments are carried through automatically is a proposed design, not yet confirmed with the client.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <MailIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Recipient</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Inquirer</p>
                <p className="font-medium text-foreground">{query.inquirer.name}</p>
                <p className="text-sm text-muted-foreground">{query.inquirer.email}</p>
              </div>

              {dispatched ? (
                <div className="rounded-md border border-status-green-line bg-status-green-bg px-3 py-2 text-sm text-status-green-fg">
                  <p className="font-medium">Response sent automatically</p>
                  <p className="mt-0.5">
                    Sent {new Date(dispatched.timestamp).toLocaleString()} to{' '}
                    {dispatched.to.join(', ')}.
                  </p>
                  {isClosed && <p className="mt-0.5">Query closed.</p>}
                </div>
              ) : canDispatch ? (
                <>
                  <p className="rounded-md border border-status-amber-line bg-status-amber-bg px-3 py-2 text-sm text-status-amber-fg">
                    The automatic dispatch did not complete. The response is approved and locked — retrying sends it without creating a second response.
                  </p>
                  <Button className="w-full" onClick={() => run(() => dispatchResponse(queryId, currentUser))}>
                    <SendIcon className="h-4 w-4" aria-hidden="true" />
                    Retry sending response
                  </Button>
                </>
              ) : (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  The response is sent automatically when the Officer-in-Charge grants final approval. Nothing to do here.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
