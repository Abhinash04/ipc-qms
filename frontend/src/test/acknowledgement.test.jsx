import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { findUserById } from '@/constants/mockUsers';
import * as mailboxService from '@/services/api/mailboxService';

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

describe('ingestion sends the acknowledgement', () => {
  it('acknowledges each newly created case', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    renderAt('/super-admin/queries');

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    await waitFor(() => {
      expect(mailboxService.sendAcknowledgement).toHaveBeenCalledWith({
        to: INQUIRER,
        queryId: 'QRY-2026-00001',
      });
    });

    expect(await screen.findByText(/1 acknowledged/)).toBeInTheDocument();
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);
  });

  it('does not acknowledge mail that was already registered', async () => {
    s().ingestEmail(MESSAGE);
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    renderAt('/super-admin/queries');

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText(/1 already registered/)).toBeInTheDocument();
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
  });

  it('keeps the case when the acknowledgement cannot be sent', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(new Error('Network Error'));
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    renderAt('/super-admin/queries');

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText('1 new case registered')).toBeInTheDocument();
    expect(s().queries).toHaveLength(1);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(0);
  });
});

describe('the email thread on the case workspace', () => {
  it('shows both emails with human-readable direction, never the raw enum', async () => {
    const { queryId } = ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    expect(await screen.findByText('Email thread')).toBeInTheDocument();
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
