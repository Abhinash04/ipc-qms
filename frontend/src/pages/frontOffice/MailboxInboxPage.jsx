import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MailIcon, RefreshCwIcon } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { fetchMailboxMessages } from '@/services/api/mailboxService';
import { buildPath } from '@/constants/routePaths';

const AUTO_REFRESH_MS = 15000;

export function MailboxInboxPage() {
  const paths = useRoutePaths();
  const queries = useWorkflowStore((state) => state.queries);
  const emailMessages = useWorkflowStore((state) => state.emailMessages);
  const { running, error, lastResult, ingestNow } = useMailboxIngestion();

  const [autoRefresh, setAutoRefresh] = useState(false);

  const inbox = useQuery({
    queryKey: ['mailbox', 'all'],
    queryFn: () => fetchMailboxMessages({ unreadOnly: false }),
    retry: false,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const messages = inbox.data?.messages || [];
  const loadError = inbox.isError ? inbox.error?.message : null;

  const registerAll = async () => {
    await ingestNow();
    await inbox.refetch();
  };

  const queryIdFor = (mailboxMessageId) =>
    emailMessages.find((m) => m.sourceMessageId === mailboxMessageId)?.queryId || null;

  return (
    <div>
      <Breadcrumb
        items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'IPC Mailbox' }]}
      />
      <PageHeader
        title="IPC Mailbox"
        purpose="Incoming enquiries waiting to be registered as Query Cases."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              <Label htmlFor="auto-refresh" className="text-sm text-muted-foreground">
                Auto-refresh (15s)
              </Label>
            </div>
            <Button variant="outline" onClick={registerAll} disabled={running}>
              <RefreshCwIcon aria-hidden="true" />
              {running ? 'Checking…' : 'Check IPC mailbox'}
            </Button>
          </div>
        }
      />

      {(error || loadError) && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-red-line bg-status-red-bg px-4 py-3 text-sm text-status-red-fg"
        >
          <p className="font-medium">Mailbox unreachable</p>
          <p className="mt-0.5">
            Could not reach the backend mailbox. Start the backend (npm start in /backend) and try again.
          </p>
        </div>
      )}

      {lastResult && !error && (
        <p className="mb-4 text-sm text-muted-foreground">
          {lastResult.created.length > 0
            ? `${lastResult.created.length} case${lastResult.created.length > 1 ? 's' : ''} registered`
            : 'No new mail to register'}
          {lastResult.skipped.length > 0 && ` · ${lastResult.skipped.length} already registered`}
          {lastResult.acknowledged?.length > 0 &&
            ` · ${lastResult.acknowledged.length} acknowledged`}
          {lastResult.forwarded?.length > 0 &&
            ` · ${lastResult.forwarded.length} forwarded to the OIC`}
        </p>
      )}

      <Card className="overflow-hidden">
        {messages.length === 0 ? (
          <EmptyState
            icon={MailIcon}
            title="No mail in the IPC mailbox"
            description="An enquiry appears here once an inquirer sends one."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead className="w-[60px] text-center">S.No.</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Query Case</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((message, index) => {
                const queryId = queryIdFor(message.mailboxMessageId);
                const known = queryId && queries.some((q) => q.queryId === queryId);

                return (
                  <TableRow key={message.mailboxMessageId}>
                    <TableCell className="text-black text-center">
                      {index + 1}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {message.from.split('<')[0].trim()}
                    </TableCell>
                    <TableCell className="text-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="truncate cursor-default" style={{ maxWidth: '200px' }}>
                              {message.subject}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[400px] break-words">
                            {message.subject}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(message.receivedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {known && paths.QUERY_DETAIL ? (
                        <Link
                          to={buildPath(paths.QUERY_DETAIL, { queryId })}
                          className="text-ring hover:underline"
                        >
                          {queryId}
                        </Link>
                      ) : (
                        <Badge variant="status-amber">Not registered</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
