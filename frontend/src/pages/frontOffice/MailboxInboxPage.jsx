import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MailIcon, RefreshCwIcon, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { fetchMailboxMessages } from '@/services/api/mailboxService';
import { buildPath } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLE_SLUG } from '@/constants/permissions';

const AUTO_REFRESH_MS = 15000;

export function MailboxInboxPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
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

  const getQueryDetailPath = (queryId) => {
    if (paths.QUERY_DETAIL) {
      return buildPath(paths.QUERY_DETAIL, { queryId });
    }
    const slug = ROLE_SLUG[currentUser?.role] || 'front-officer';
    return `/${slug}/queries/${queryId}`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'IPC Mailbox' }]}
      />

      <PageHeader
        greeting="IPC Live Mailbox 📬"
        title="IPC Mailbox Inbox"
        purpose="Incoming enquiries waiting to be ingested and registered as Query Cases."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#f1f5fa] border border-white px-3.5 py-2 rounded-2xl shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff]">
              <Checkbox
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              <Label htmlFor="auto-refresh" className="text-[12.5px] font-semibold text-slate-600 cursor-pointer">
                Auto-refresh (15s)
              </Label>
            </div>

            <button
              type="button"
              onClick={registerAll}
              disabled={running}
              className="flex items-center gap-2 rounded-2xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-5 py-2.5 text-[13.5px] font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
            >
              <RefreshCwIcon className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              <span>{running ? 'Checking Mailbox…' : 'Check IPC Mailbox'}</span>
            </button>
          </div>
        }
      />

      {(error || loadError) && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4.5 text-slate-700 shadow-sm flex items-start gap-3.5"
        >
          <ShieldAlert className="h-6 w-6 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-[14px] text-rose-900">Mailbox server offline / unreachable</p>
            <p className="mt-1 text-[12.5px] font-medium text-rose-700 leading-relaxed">
              Could not connect to the backend mailbox service. Please verify backend is running (`npm start` in `/backend`).
            </p>
          </div>
        </div>
      )}

      {lastResult && !error && (
        <div className="rounded-2xl bg-[#f1f5fa] border border-white p-3.5 shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff] text-[13px] font-bold text-slate-700 flex items-center gap-2">
          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
          <span>
            {lastResult.created.length > 0
              ? `${lastResult.created.length} case${lastResult.created.length > 1 ? 's' : ''} registered`
              : 'No new mail to register'}
            {lastResult.skipped.length > 0 && ` · ${lastResult.skipped.length} already registered`}
            {lastResult.acknowledged?.length > 0 && ` · ${lastResult.acknowledged.length} acknowledged`}
          </span>
        </div>
      )}

      <div className="bg-[#f1f5fa] rounded-3xl border border-white/80 overflow-hidden shadow-[12px_12px_24px_#d0d7e5,-12px_-12px_24px_#ffffff]">
        {messages.length === 0 ? (
          <div className="p-10 text-center">
            <EmptyState
              icon={MailIcon}
              title="No mail in the IPC mailbox"
              description="Incoming enquiries will automatically appear here."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow hoverable={false}>
                <TableHead className="w-15 text-center">S.No.</TableHead>
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
                          <TooltipContent className="max-w-100 wrap-break-word">
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
                          to={getQueryDetailPath(queryId)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-1.5 text-[11.5px] font-black shadow-md shadow-blue-500/20 transition-all hover:scale-105"
                        >
                          <span>{queryId}</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-300/80 px-3 py-1 text-[11px] font-extrabold shadow-[2px_2px_4px_#d0d7e5,-2px_-2px_4px_#ffffff]">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Not registered
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

