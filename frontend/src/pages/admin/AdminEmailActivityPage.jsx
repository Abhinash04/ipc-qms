import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mail, Inbox, Send, AlertTriangle } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { AuditTable } from '@/components/admin/AuditTable';
import { fetchAuditEvents, fetchAuditSummary } from '@/services/api/adminService';
import { fetchMailboxMessages } from '@/services/api/mailboxService';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { buildPath } from '@/constants/routePaths';
import { useWorkflowStore } from '@/store/useWorkflowStore';

/**
 * Email activity, and the trace from a message to its case.
 *
 * Inbound comes from the live mailbox (`GET /mailbox/messages`); everything
 * outbound — sends, forwards, dispatches and failures — comes from the audit
 * trail, because outbound mail is not stored in the mailbox.
 */
export function AdminEmailActivityPage() {
  const paths = useRoutePaths();
  const navigate = useNavigate();
  const emailMessages = useWorkflowStore((state) => state.emailMessages);

  const summary = useQuery({ queryKey: ['audit', 'summary'], queryFn: () => fetchAuditSummary(), retry: false });
  const inbox = useQuery({
    queryKey: ['mailbox', 'admin'],
    queryFn: () => fetchMailboxMessages({ unreadOnly: false }),
    retry: false,
  });
  const outbound = useQuery({
    queryKey: ['audit', 'email'],
    queryFn: () => fetchAuditEvents({ limit: 100 }),
    retry: false,
  });

  const byAction = summary.data?.overall?.byAction || {};
  const emailEvents = (outbound.data?.events || []).filter((event) => event.action.startsWith('EMAIL_'));
  const messages = inbox.data?.messages || [];

  /** The message → case link the workflow store already holds. */
  const queryIdFor = (mailboxMessageId) =>
    emailMessages.find((m) => m.sourceMessageId === mailboxMessageId)?.queryId || null;

  const tiles = [
    {
      label: 'In the mailbox',
      value: messages.length,
      icon: Inbox,
      cardBg: 'bg-blue-50/70',
      cardBorder: 'border-blue-200/70',
      numColor: 'text-blue-700',
      iconBg: 'bg-blue-100 text-blue-700',
    },
    {
      label: 'Sent',
      value: (byAction.EMAIL_SENT ?? 0) + (byAction.EMAIL_REPLIED ?? 0),
      icon: Send,
      cardBg: 'bg-emerald-50/70',
      cardBorder: 'border-emerald-200/70',
      numColor: 'text-emerald-700',
      iconBg: 'bg-emerald-100 text-emerald-700',
    },
    {
      label: 'Forwarded',
      value: byAction.EMAIL_FORWARDED ?? 0,
      icon: Mail,
      cardBg: 'bg-violet-50/70',
      cardBorder: 'border-violet-200/70',
      numColor: 'text-violet-700',
      iconBg: 'bg-violet-100 text-violet-700',
    },
    {
      label: 'Send failures',
      value: byAction.EMAIL_SEND_FAILED ?? 0,
      icon: AlertTriangle,
      cardBg: 'bg-rose-50/70',
      cardBorder: 'border-rose-200/70',
      numColor: 'text-rose-700',
      iconBg: 'bg-rose-100 text-rose-700',
    },
  ];

  const panel = 'rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm';

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Administration', path: paths.ADMINISTRATION },
          { label: 'Email Activity' },
        ]}
      />
      <PageHeader title="Email Activity" purpose="Inbound mail, outbound mail, and the case each one belongs to." />

      {summary.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <StatTile key={tile.label} {...tile} />
          ))}
        </div>
      )}

      <section className={panel} aria-labelledby="inbound">
        <h2 id="inbound" className="mb-3 font-heading text-[17px] font-black text-slate-900">
          Inbound mailbox
        </h2>

        {inbox.isLoading && <Skeleton className="h-32 w-full rounded-2xl" />}
        {inbox.isError && (
          <p className="text-[13px] text-slate-500">The mailbox could not be reached.</p>
        )}
        {inbox.data && messages.length === 0 && (
          <EmptyState icon={Inbox} title="The mailbox is empty" description="No messages are currently held." />
        )}
        {messages.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  <th scope="col" className="px-3 py-2">Received</th>
                  <th scope="col" className="px-3 py-2">From</th>
                  <th scope="col" className="px-3 py-2">Subject</th>
                  <th scope="col" className="px-3 py-2 text-center">Attachments</th>
                  <th scope="col" className="px-3 py-2">Case</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => {
                  const queryId = queryIdFor(message.mailboxMessageId);
                  return (
                    <tr key={message.mailboxMessageId} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] tabular-nums text-slate-600">
                        {new Date(message.receivedAt).toLocaleString(undefined, {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-slate-700">{message.from}</td>
                      <td className="px-3 py-2.5 text-[12.5px] font-semibold text-slate-800">{message.subject}</td>
                      <td className="px-3 py-2.5 text-center text-[12.5px] tabular-nums text-slate-600">
                        {message.attachments?.length || 0}
                      </td>
                      <td className="px-3 py-2.5">
                        {queryId ? (
                          <button
                            type="button"
                            onClick={() => paths.QUERY_DETAIL && navigate(buildPath(paths.QUERY_DETAIL, { queryId }))}
                            className="rounded font-mono text-[11.5px] font-bold text-blue-700 underline-offset-2 hover:underline"
                          >
                            {queryId}
                          </button>
                        ) : (
                          <span className="text-[11.5px] font-semibold text-amber-700">Not registered</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={panel} aria-labelledby="outbound">
        <h2 id="outbound" className="mb-3 font-heading text-[17px] font-black text-slate-900">
          Outbound and delivery events
        </h2>
        <AuditTable
          events={emailEvents}
          loading={outbound.isLoading}
          error={outbound.isError ? 'The audit API could not be reached.' : null}
          onOpenQuery={(queryId) => paths.QUERY_DETAIL && navigate(buildPath(paths.QUERY_DETAIL, { queryId }))}
          emptyTitle="No email events recorded yet"
        />
      </section>
    </div>
  );
}
