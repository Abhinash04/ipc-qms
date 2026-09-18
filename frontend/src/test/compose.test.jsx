import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLES } from '@/constants/roles';
import * as mailboxService from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService');

const CONFIG = {
  transport: 'mock',
  ipcQueryEmail: 'configured-ipc@test.invalid',
  ipcReplyFrom: { email: 'arnd@test.invalid', name: 'AR&D Division' },
  inquirer: { email: 'configured-inquirer@test.invalid', name: 'Configured Inquirer' },
};

const COMPOSE = '/inquirer/compose';
const QUERIES = '/super-admin/queries';

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

function signIn(role) {
  useAuthStore.setState({
    currentUser: { id: 'USR-TEST', name: 'Test User', role, email: 'test@ipc.example' },
  });
}

beforeEach(async () => {
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue(CONFIG);
  vi.mocked(mailboxService.sendEnquiry).mockResolvedValue({ providerMessageId: 'mock-msg-1' });
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('compose enquiry page', () => {
  it('renders for the inquirer', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);
    expect(await screen.findByRole('heading', { name: 'Raise Enquiry' })).toBeInTheDocument();
  });

  it('takes From and To from the backend config, not from hard-coded strings', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    await waitFor(() => {
      expect(screen.getByLabelText('From')).toHaveValue(
        'Configured Inquirer <configured-inquirer@test.invalid>',
      );
    });
    expect(screen.getByLabelText('To')).toHaveValue('configured-ipc@test.invalid');
  });

  it('makes From and To read-only — the inquirer cannot redirect the enquiry', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    expect(await screen.findByLabelText('From')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('To')).toHaveAttribute('readonly');
  });

  it('says plainly that the mock transport sends nothing over the internet', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);
    expect(
      await screen.findByText(/Mock transport active — no mail leaves this machine/),
    ).toBeInTheDocument();
  });

  it('warns that Gmail sends a real email — but only if this sender actually can', async () => {
    vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({
      ...CONFIG,
      transport: 'gmail',
      participants: [{ role: 'INQUIRER', canSendReal: true }],
    });
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    expect(await screen.findByText(/Gmail transport active/)).toBeInTheDocument();
    expect(screen.queryByText(/Mock transport active/)).not.toBeInTheDocument();
  });

  it('does not promise a real email when this role has no Gmail credential', async () => {
    // `transport: gmail` is the deployment-wide setting; whether the inquirer
    // can use it is a per-role question. Only the Front Office mailbox is
    // authenticated now, so this banner claiming "sends a real email" would be
    // a lie the mock transport quietly swallows.
    vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({
      ...CONFIG,
      transport: 'gmail',
      participants: [{ role: 'INQUIRER', canSendReal: false }],
    });
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    expect(await screen.findByText(/Simulated enquiry/)).toBeInTheDocument();
    expect(screen.queryByText(/sends a real email/)).not.toBeInTheDocument();
  });

  it('will not send an empty enquiry', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    const button = await screen.findByRole('button', { name: /Send enquiry/ });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Only a subject' } });
    expect(button).toBeDisabled();
  });

  it('sends the typed subject and body', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), {
      target: { value: 'Clarification regarding submission requirements' },
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Dear Sir/Madam, please clarify the required documents.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => {
      expect(mailboxService.sendEnquiry).toHaveBeenCalledWith({
        subject: 'Clarification regarding submission requirements',
        body: 'Dear Sir/Madam, please clarify the required documents.',
      });
    });

    expect(await screen.findByText('Enquiry raised successfully')).toBeInTheDocument();
    expect(screen.getByText(/mock-msg-1/)).toBeInTheDocument();

    // Sending is not the whole job — the case must exist straight away.
    const raised = useWorkflowStore
      .getState()
      .queries.find((q) => q.subject === 'Clarification regarding submission requirements');
    expect(raised).toBeDefined();
    expect(raised.source).toBe('Portal');
    expect(raised.inquirer.id).toBe('USR-TEST');
    expect(screen.getByText(raised.queryId)).toBeInTheDocument();
  });

  it('reports a send failure instead of pretending it worked', async () => {
    vi.mocked(mailboxService.sendEnquiry).mockRejectedValue(new Error('Network Error'));
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    expect(await screen.findByText(/Send failed: Network Error/)).toBeInTheDocument();
    expect(screen.queryByText('Enquiry raised')).not.toBeInTheDocument();
    // A failed send must not leave a phantom case behind.
    expect(useWorkflowStore.getState().queries.some((q) => q.subject === 'S')).toBe(false);
  });

  it('tells the inquirer when the backend is unreachable', async () => {
    vi.mocked(mailboxService.fetchEmailConfig).mockRejectedValue(new Error('Network Error'));
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send enquiry/ })).toBeDisabled();
  });
});

describe('compose enquiry RBAC (negative)', () => {
  it.each([ROLES.REVIEWER, ROLES.ASSIGNED_OFFICIAL, ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE])(
    'denies the inquirer compose URL to %s',
    async (role) => {
      signIn(role);
      renderAt(COMPOSE);

      expect(await screen.findByText('Access restricted')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Raise Enquiry' })).not.toBeInTheDocument();
    },
  );

  it('denies the caseload to the inquirer — internal queries are not theirs to see', async () => {
    signIn(ROLES.INQUIRER);
    renderAt('/front-officer/queries');

    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
  });
});

/**
 * The queries list used to carry a "Check IPC mailbox" button that registered
 * every unread message in one click. Bulk registration is exactly what the
 * validation gate exists to prevent, so the button is gone: mail is accepted or
 * rejected one message at a time, in the inbox. Those behaviours are covered in
 * `mailboxInbox.test.jsx`.
 */
describe('the queries list no longer registers mail', () => {
  const MESSAGE = {
    mailboxMessageId: 'MSG-00001',
    to: 'configured-ipc@test.invalid',
    from: 'A Member of the Public <someone@example.com>',
    subject: 'Clarification regarding submission requirements',
    body: 'Dear Sir/Madam…',
    receivedAt: '2026-08-17T09:00:00.000Z',
  };

  it('offers no bulk registration control', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    await screen.findByRole('heading', { name: /Quer/ });
    expect(screen.queryByRole('button', { name: /Check IPC mailbox/ })).toBeNull();
  });

  it('shows no case for mail that is only waiting in the mailbox', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    await screen.findByRole('heading', { name: /Quer/ });

    // Unread mail exists, and no case does. Nothing registers it but a person.
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    expect(mailboxService.markMessageIngested).not.toHaveBeenCalled();
  });
});

