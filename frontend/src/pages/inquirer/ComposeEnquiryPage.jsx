import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SendIcon } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { buildPath } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { fetchEmailConfig, sendEnquiry } from '@/services/api/mailboxService';

export function ComposeEnquiryPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const raiseEnquiry = useWorkflowStore((state) => state.raiseEnquiry);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [raisedQueryId, setRaisedQueryId] = useState(null);

  const config = useQuery({ queryKey: ['emailConfig'], queryFn: fetchEmailConfig, retry: false });
  const send = useMutation({
    mutationFn: async () => {
      const sent = await sendEnquiry({ subject: subject.trim(), body });
      // The case is opened here rather than waiting for Front Office to ingest
      // the mail copy, so the inquirer sees it on their dashboard immediately.
      const raised = raiseEnquiry({
        subject: subject.trim(),
        body,
        inquirer: {
          id: currentUser?.id || null,
          name: currentUser?.name || '',
          email: currentUser?.email || '',
        },
        to: config.data?.ipcQueryEmail || null,
        providerMessageId: sent?.providerMessageId || null,
        // Deliberately not storing sent.providerThreadId: a thread id is private
        // to the mailbox that produced it, and this one is the inquirer's. Front
        // Office cannot reply into it. The mailbox copy, when claimed, brings the
        // Front Office thread id that everyone downstream can actually use.
      });
      return { ...sent, queryId: raised.queryId };
    },
    onSuccess: (result) => {
      setRaisedQueryId(result.queryId);
      setSubject('');
      setBody('');
    },
  });

  const from = config.data
    ? `${config.data.inquirer.name} <${config.data.inquirer.email}>`
    : 'Loading…';
  const to = config.data?.ipcQueryEmail || 'Loading…';
  const transport = config.data?.transport;
  const canSend = Boolean(config.data) && subject.trim() !== '' && body.trim() !== '';

  return (
    <div>
      <Breadcrumb
        items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Raise Enquiry' }]}
      />
      <PageHeader
        title="Raise Enquiry"
        purpose="Send an enquiry to the Indian Pharmacopoeia Commission query mailbox."
      />

      {config.isError && (
        <div className="mb-6 rounded-md border border-status-red-line bg-status-red-bg px-4 py-3 text-sm text-status-red-fg">
          <p className="font-medium">Backend unreachable</p>
          <p className="mt-0.5">
            Could not load the email configuration. Start the backend (npm start in /backend) and reload this page.
          </p>
        </div>
      )}

      {transport === 'mock' && (
        <div className="mb-6 rounded-md border border-status-blue-line bg-status-blue-bg px-4 py-3 text-sm text-status-blue-fg">
          <p className="font-medium">Mock transport active — no mail leaves this machine</p>
          <p className="mt-0.5">
            The enquiry is delivered straight into the mock IPC mailbox ({to}). Nothing is sent over the internet, and that address is a reserved test domain that cannot receive real mail.
          </p>
        </div>
      )}

      {transport === 'gmail' && (
        <div className="mb-6 rounded-md border border-status-orange-line bg-status-orange-bg px-4 py-3 text-sm text-status-orange-fg">
          <p className="font-medium">Gmail transport active — this sends a real email</p>
          <p className="mt-0.5">
            The message is sent from {from} through Gmail and will appear in that account&apos;s Sent folder.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">New enquiry</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="enquiry-from">From</Label>
                  <Input id="enquiry-from" value={from} readOnly className="bg-muted" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="enquiry-to">To</Label>
                  <Input id="enquiry-to" value={to} readOnly className="bg-muted" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enquiry-subject">Subject</Label>
                <Input
                  id="enquiry-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Clarification regarding submission requirements…"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enquiry-body">Message</Label>
                <Textarea
                  id="enquiry-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="resize-none"
                  placeholder="Dear Sir/Madam,&#10;&#10;I am writing to seek clarification regarding…"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => send.mutate()} disabled={!canSend || send.isPending}>
                  <SendIcon aria-hidden="true" />
                  {send.isPending ? 'Sending…' : 'Send enquiry'}
                </Button>
                {send.isError && (
                  <p className="text-sm text-status-red-fg">
                    Send failed: {send.error?.message || 'unknown error'}
                  </p>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">What happens next</h2>
            </CardHeader>
            <CardBody className="space-y-3 text-sm text-muted-foreground">
              {send.isSuccess ? (
                <div className="rounded-md border border-status-green-line bg-status-green-bg px-3 py-2 text-status-green-fg">
                  <p className="font-medium">Enquiry raised</p>
                  {raisedQueryId && (
                    <p className="mt-1">
                      Your case is{' '}
                      {paths.QUERY_DETAIL ? (
                        <Link
                          to={buildPath(paths.QUERY_DETAIL, { queryId: raisedQueryId })}
                          className="font-semibold underline"
                        >
                          {raisedQueryId}
                        </Link>
                      ) : (
                        <span className="font-semibold">{raisedQueryId}</span>
                      )}
                      . It is already on your dashboard.
                    </p>
                  )}
                  <p className="mt-1 break-all">
                    Provider message id: {send.data?.providerMessageId}
                  </p>
                </div>
              ) : (
                <p>
                  Your enquiry opens a Query Case straight away and is emailed to the IPC query mailbox. Front Office verifies it, then it is assigned, drafted, reviewed, approved and finally dispatched back to you by email.
                </p>
              )}
              <p>
                Track the case on your dashboard. You will also receive the reply by email once IPC closes the query.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
