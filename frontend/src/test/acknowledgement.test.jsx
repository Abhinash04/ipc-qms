import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { findUserById } from '@/constants/mockUsers';
import * as mailboxService from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService');

const INQUIRER = 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>';

const MESSAGE = {
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: INQUIRER,
  subject: 'Clarification regarding submission requirements',
  body: 'Dear Sir/Madam…',
  receivedAt: '2026-08-17T09:00:00.000Z',
};

const ACK_RESPONSE = {
  from: 'AR&D Division <arnd-ipc-mock@example.com>',
  to: [INQUIRER],
  subject: 'Acknowledgement of Query Received – Indian Pharmacopoeia Commission [QRY-2026-00001]',
  body: 'Dear Sir/Madam,\n\nThis is to acknowledge that we have received your email/query.',
  providerMessageId: 'mock-msg-2',
  sentAt: '2026-08-17T09:00:05.000Z',
};

const s = () => useWorkflowStore.getState();

function renderAt(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ingestAndAcknowledge(message = MESSAGE, ack = ACK_RESPONSE) {
  const { queryId } = s().ingestEmail(message);
  const outcome = s().recordAcknowledgement({
    queryId,
    from: ack.from,
    to: ack.to,
    subject: ack.subject,
    body: ack.body,
    timestamp: ack.sentAt,
    providerMessageId: ack.providerMessageId,
  });
  return { queryId, outcome };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK_RESPONSE);
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd-ipc-mock@example.com', name: 'AR&D Division' },
    inquirer: { email: 'abhinash.pritiraj@gmail.com', name: 'Abhinash Pritiraj' },
  });

  useAuthStore.setState({ currentUser: findUserById('USR-0008') });
  await s().hydrate();
  await s().resetDemo();
});

describe('recording the acknowledgement', () => {
  it('lands on the same thread as the enquiry', () => {
    const { queryId } = ingestAndAcknowledge();

    const query = s().queries.find((q) => q.queryId === queryId);
    const messages = s().emailMessages.filter((m) => m.queryId === queryId);

    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.threadId))).toEqual(new Set([query.threadId]));
    expect(s().emailThreads.filter((t) => t.queryId === queryId)).toHaveLength(1);
  });

  it('is OUTBOUND — direction is from the IPC perspective', () => {
    const { queryId } = ingestAndAcknowledge();
    const ack = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
    );

    expect(ack.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(ack.to).toEqual([INQUIRER]);
    expect(ack.from).toContain('arnd-ipc-mock@example.com');
  });

  it('keeps the subject and body the backend template produced', () => {
    const { queryId } = ingestAndAcknowledge();
    const ack = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT);

    expect(ack.subject).toBe(ACK_RESPONSE.subject);
    expect(ack.subject).toContain(queryId);
    expect(ack.body).toBe(ACK_RESPONSE.body);
    expect(ack.providerMessageId).toBe('mock-msg-2');
  });

  it('emits exactly one ACKNOWLEDGEMENT_SENT audit event', () => {
    const { queryId } = ingestAndAcknowledge();
    const events = s()
      .getAudit(queryId)
      .filter((a) => a.event === AUDIT_EVENT.ACKNOWLEDGEMENT_SENT);

    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('System');
    expect(events[0].details).toContain(INQUIRER);
  });

  it('does not change the workflow state — it is a courtesy email, not a step', () => {
    const { queryId } = ingestAndAcknowledge();
    const query = s().queries.find((q) => q.queryId === queryId);

    expect(query.workflowState).toBe('RECEIVED');
    expect(query.businessStatus).toBe('OPEN');
    expect(query.currentAssigneeId).toBeNull();
  });

  it('leaves the inbound enquiry untouched', () => {
    const { queryId } = ingestAndAcknowledge();
    const inbound = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.INCOMING_QUERY);

    expect(inbound.subject).toBe(MESSAGE.subject);
    expect(inbound.body).toBe(MESSAGE.body);
    expect(inbound.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(inbound.queryId).toBe(queryId);
  });

  it('refuses to acknowledge a query that does not exist', () => {
    const outcome = s().recordAcknowledgement({
      queryId: 'QRY-2026-99999',
      from: 'a@b.c',
      to: ['x@y.z'],
      subject: 'S',
      body: 'B',
    });

    expect(outcome).toMatchObject({ created: false, reason: 'unknown-query' });
    expect(s().emailMessages).toHaveLength(0);
  });
});

describe('acknowledgement is idempotent — one per query', () => {
  it('a second call creates nothing', () => {
    const { queryId } = ingestAndAcknowledge();
    const before = {
      messages: s().emailMessages.length,
      audit: s().getAudit(queryId).length,
      counters: { ...s().counters },
    };

    const second = s().recordAcknowledgement({
      queryId,
      from: ACK_RESPONSE.from,
      to: ACK_RESPONSE.to,
      subject: ACK_RESPONSE.subject,
      body: ACK_RESPONSE.body,
    });

    expect(second).toMatchObject({ created: false, reason: 'already-acknowledged' });
    expect(s().emailMessages).toHaveLength(before.messages);
    expect(s().getAudit(queryId)).toHaveLength(before.audit);
    expect(s().counters).toEqual(before.counters);
  });

  it('survives a simulated reload — the guard lives in IndexedDB', async () => {
    const { queryId } = ingestAndAcknowledge();
    await new Promise((r) => setTimeout(r, 50));

    useWorkflowStore.setState({ emailMessages: [], emailThreads: [], queries: [], hydrated: false });
    await s().hydrate();

    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);

    const again = s().recordAcknowledgement({
      queryId,
      from: ACK_RESPONSE.from,
      to: ACK_RESPONSE.to,
      subject: ACK_RESPONSE.subject,
      body: ACK_RESPONSE.body,
    });

    expect(again.created).toBe(false);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);
  });

  it('acknowledges two different queries separately', () => {
    const first = ingestAndAcknowledge();
    const second = ingestAndAcknowledge({ ...MESSAGE, mailboxMessageId: 'MSG-00002' });

    expect(first.queryId).not.toBe(second.queryId);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(2);
  });
});

/**
 * Accepting a message is what acknowledges its sender, and it is the accept
 * endpoint that sends it — one server call registers the case, emails whoever
 * wrote in and forwards to the Officer-in-Charge. Arriving mail still
 * acknowledges nothing on its own: an advertisement must not be thanked for its
 * enquiry. What is left for the browser is the request and the reporting.
 */
describe('accepting a message sends the acknowledgement', () => {
  it('hands the endpoint the message its sender is read off, and reports the answer', async () => {
    const external = {
      ...MESSAGE,
      mailboxMessageId: 'MSG-EXTERNAL-1',
      from: 'Ravi Kumar <ravi@pharma.example>',
    };
    const accept = vi.fn(fakeAcceptEndpoint());

    const result = await s().acceptMailboxMessage(external, accept);

    // The From header is the only place the inquirer comes from, so the whole
    // message goes with the request and the server reads it there. That the
    // acknowledgement really reaches ravi@pharma.example, and nobody else, is
    // asserted in backend/src/test/acceptMessage.test.js.
    expect(accept).toHaveBeenCalledWith('MSG-EXTERNAL-1', external);
    expect(result.acknowledged).toBe(true);

    // The browser sends no mail at all on this path.
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();

    // And the acknowledgement the server sent is read back onto the case.
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);
  });

  it('creates nothing, and sends nothing, for mail that was already registered', async () => {
    const { queryId } = s().ingestEmail(MESSAGE);
    // The endpoint recognises a message it has already accepted — the guard is
    // the stored decision in the database, not anything this tab remembers — so
    // it answers from the record instead of creating a second case.
    const accept = vi.fn(async () => ({
      queryId,
      created: false,
      alreadyDecided: true,
      acknowledged: true,
      forwarded: true,
      errors: [],
    }));

    const result = await s().acceptMailboxMessage(MESSAGE, accept);

    expect(result).toMatchObject({ queryId, created: false, alreadyDecided: true, accepted: false });
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
    expect(s().queries).toHaveLength(1);
  });

  it('keeps the case when the acknowledgement cannot be sent', async () => {
    const accept = fakeAcceptEndpoint({
      acknowledged: false,
      errors: [{ step: 'acknowledgement', error: 'Network Error' }],
    });

    const result = await s().acceptMailboxMessage(MESSAGE, accept);

    // A failed acknowledgement is reported, never thrown: the case exists, and
    // losing its id would be far worse than an email nobody received. The case
    // page offers the retry.
    expect(result.accepted).toBe(true);
    expect(result.acknowledged).toBe(false);
    expect(result.errors).toEqual([{ step: 'acknowledgement', error: 'Network Error' }]);
    expect(s().queries.map((q) => q.queryId)).toEqual([result.queryId]);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(0);
  });

  it('acknowledges nothing for a message that is merely sitting in the mailbox', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    renderAt('/super-admin/queries');
    await screen.findByRole('heading', { name: /Quer/ });

    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
    expect(s().queries).toHaveLength(0);
  });
});

describe('the email thread on the case workspace', () => {
  it('shows both emails with human-readable direction, never the raw enum', async () => {
    const { queryId } = ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    expect(await screen.findByText('Email thread')).toBeInTheDocument();

    // Only the newest message is expanded now, so reveal and open the earlier
    // one before checking both carry human-readable labels.
    fireEvent.click(screen.getByRole('button', { name: /Show 1 previous message/ }));
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('Received by IPC')).toBeInTheDocument();
    expect(screen.getByText('Sent by IPC')).toBeInTheDocument();
    expect(screen.getByText('Original enquiry')).toBeInTheDocument();
    expect(screen.getByText('Acknowledgement')).toBeInTheDocument();

    expect(screen.queryByText('INBOUND')).not.toBeInTheDocument();
    expect(screen.queryByText('OUTBOUND')).not.toBeInTheDocument();
    expect(screen.queryByText('INCOMING_QUERY')).not.toBeInTheDocument();
  });

  it('orders the thread oldest first', async () => {
    const { queryId } = ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    const subjects = (await screen.findAllByText(/Clarification|Acknowledgement of Query/)).map(
      (el) => el.textContent,
    );
    expect(subjects[0]).toContain('Clarification regarding submission requirements');
  });

  it('records the acknowledgement in the audit history the user can see', async () => {
    const { queryId } = ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    expect(await screen.findByText('Audit history')).toBeInTheDocument();
    expect(screen.getByText('ACKNOWLEDGEMENT SENT')).toBeInTheDocument();
  });
});

