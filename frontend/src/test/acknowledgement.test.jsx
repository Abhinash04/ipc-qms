import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { findUserById, MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import * as mailboxService from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';
import { installFakeCaseMail } from '@/test/fakeCaseMail';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService');

const INQUIRER = 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>';

const MESSAGE = {
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: INQUIRER,
  subject: 'Clarification regarding submission requirements',
  body: 'Dear Sir/Madam…',
  receivedAt: '2026-08-17T09:00:00.000Z',
};

const INQUIRER_EMAIL = 'abhinash.pritiraj@pharma.example';

const FRONT_OFFICE = MOCK_USERS.find((u) => u.role === ROLES.FRONT_OFFICE).email;

let caseMail;

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

async function ingestAndAcknowledge(message = MESSAGE) {
  const { queryId } = s().ingestEmail(message);
  const outcome = await s().acknowledgeInquirer(queryId, null);
  return { queryId, outcome };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  caseMail = installFakeCaseMail(mailboxService);
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
  });

  useAuthStore.setState({ currentUser: findUserById('USR-0008') });
  await s().hydrate();
  await s().resetDemo();
});

describe('recording the acknowledgement', () => {
  it('lands on the same thread as the enquiry', async () => {
    const { queryId } = await ingestAndAcknowledge();

    const query = s().queries.find((q) => q.queryId === queryId);
    const messages = s().emailMessages.filter((m) => m.queryId === queryId);

    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.threadId))).toEqual(new Set([query.threadId]));
    expect(s().emailThreads.filter((t) => t.queryId === queryId)).toHaveLength(1);
  });

  it('is OUTBOUND — direction is from the IPC perspective', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const ack = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
    );

    expect(ack.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(ack.to).toEqual([INQUIRER_EMAIL]);
    expect(ack.from).toContain(FRONT_OFFICE);
  });

  it('keeps the subject the backend template produced', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const ack = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT);

    expect(ack.subject).toContain('Acknowledgement of Query Received');
    expect(ack.subject).toContain(queryId);
    expect(ack.providerMessageId).toBeTruthy();
  });

  it('emits exactly one ACKNOWLEDGEMENT_SENT audit event', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const events = s()
      .getAudit(queryId)
      .filter((a) => a.event === AUDIT_EVENT.ACKNOWLEDGEMENT_SENT);

    expect(events).toHaveLength(1);
    expect(events[0].details).toContain(INQUIRER_EMAIL);
  });

  it('does not change the workflow state — it is a courtesy email, not a step', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const query = s().queries.find((q) => q.queryId === queryId);

    expect(query.workflowState).toBe('RECEIVED');
    expect(query.businessStatus).toBe('OPEN');
    expect(query.currentAssigneeId).toBeNull();
  });

  it('leaves the inbound enquiry untouched', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const inbound = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.INCOMING_QUERY);

    expect(inbound.subject).toBe(MESSAGE.subject);
    expect(inbound.body).toBe(MESSAGE.body);
    expect(inbound.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(inbound.queryId).toBe(queryId);
  });

  it('refuses to acknowledge a query that does not exist', async () => {
    const outcome = await s().acknowledgeInquirer('QRY-2026-99999', null);

    expect(outcome.acknowledged).toBe(false);
    expect(outcome.error).toMatch(/does not exist/);
    expect(caseMail.calls.ACKNOWLEDGEMENT).toBe(0);
    expect(s().emailMessages).toHaveLength(0);
  });
});

describe('acknowledgement is idempotent — one per query', () => {
  it('a second call creates nothing', async () => {
    const { queryId } = await ingestAndAcknowledge();
    const before = {
      messages: s().emailMessages.length,
      audit: s().getAudit(queryId).length,
    };

    const second = await s().acknowledgeInquirer(queryId, null);

    expect(second).toMatchObject({ acknowledged: true, alreadySent: true });
    expect(s().emailMessages).toHaveLength(before.messages);
    expect(s().getAudit(queryId)).toHaveLength(before.audit);
  });

  it('survives a simulated reload — the guard is the stored record', async () => {
    const { queryId } = await ingestAndAcknowledge();
    await new Promise((r) => setTimeout(r, 50));

    useWorkflowStore.setState({ emailMessages: [], emailThreads: [], queries: [], hydrated: false });
    await s().hydrate();

    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);

    const again = await s().acknowledgeInquirer(queryId, null);

    expect(again.alreadySent).toBe(true);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);
  });

  it('acknowledges two different queries separately', async () => {
    const first = await ingestAndAcknowledge();
    const second = await ingestAndAcknowledge({ ...MESSAGE, mailboxMessageId: 'MSG-00002' });

    expect(first.queryId).not.toBe(second.queryId);
    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(2);
  });
});

describe('accepting a message sends the acknowledgement', () => {
  it('hands the endpoint the message its sender is read off, and reports the answer', async () => {
    const external = {
      ...MESSAGE,
      mailboxMessageId: 'MSG-EXTERNAL-1',
      from: 'Ravi Kumar <ravi@pharma.example>',
    };
    const accept = vi.fn(fakeAcceptEndpoint());

    const result = await s().acceptMailboxMessage(external, accept);

    expect(accept).toHaveBeenCalledWith('MSG-EXTERNAL-1', external);
    expect(result.acknowledged).toBe(true);

    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();

    expect(
      s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT),
    ).toHaveLength(1);
  });

  it('creates nothing, and sends nothing, for mail that was already registered', async () => {
    const { queryId } = s().ingestEmail(MESSAGE);
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
    const { queryId } = await ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    expect(await screen.findByText('Email thread')).toBeInTheDocument();

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
    const { queryId } = await ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    const subjects = (await screen.findAllByText(/Clarification|Acknowledgement of Query/)).map(
      (el) => el.textContent,
    );
    expect(subjects[0]).toContain('Clarification regarding submission requirements');
  });

  it('records the acknowledgement in the audit history the user can see', async () => {
    const { queryId } = await ingestAndAcknowledge();
    renderAt(`/super-admin/queries/${queryId}`);

    expect(await screen.findByText('Audit history')).toBeInTheDocument();
    expect(screen.getByText('ACKNOWLEDGEMENT SENT')).toBeInTheDocument();
  });
});

