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

  it('warns instead that Gmail sends a real email', async () => {
    vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({ ...CONFIG, transport: 'gmail' });
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    expect(await screen.findByText(/Gmail transport active/)).toBeInTheDocument();
    expect(screen.queryByText(/Mock transport active/)).not.toBeInTheDocument();
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

    expect(await screen.findByText('Enquiry sent')).toBeInTheDocument();
    expect(screen.getByText(/mock-msg-1/)).toBeInTheDocument();
  });

  it('reports a send failure instead of pretending it worked', async () => {
    vi.mocked(mailboxService.sendEnquiry).mockRejectedValue(new Error('Network Error'));
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    expect(await screen.findByText(/Send failed: Network Error/)).toBeInTheDocument();
    expect(screen.queryByText('Enquiry sent')).not.toBeInTheDocument();
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

describe('mailbox ingestion trigger', () => {
  const MESSAGE = {
    mailboxMessageId: 'MSG-00001',
    to: 'configured-ipc@test.invalid',
    from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
    subject: 'Clarification regarding submission requirements',
    body: 'Dear Sir/Madam…',
    receivedAt: '2026-08-17T09:00:00.000Z',
  };

  it('turns mailbox mail into a visible Query Case', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    expect(useWorkflowStore.getState().queries).toHaveLength(0);

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText('1 new case registered')).toBeInTheDocument();
    expect(useWorkflowStore.getState().queries).toHaveLength(1);
    expect(await screen.findByText('QRY-2026-00001')).toBeInTheDocument();
    expect(mailboxService.markMessageIngested).toHaveBeenCalledWith('MSG-00001');
  });

  it('reports already-registered mail as skipped rather than duplicating it', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [MESSAGE] });
    useWorkflowStore.getState().ingestEmail(MESSAGE);

    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText(/1 already registered/)).toBeInTheDocument();
    expect(useWorkflowStore.getState().queries).toHaveLength(1);
  });

  it('says so when there is no new mail', async () => {
    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText('No new mail')).toBeInTheDocument();
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
  });

  it('surfaces a mailbox failure instead of silently doing nothing', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(new Error('Network Error'));
    signIn(ROLES.SUPER_ADMIN);
    renderAt(QUERIES);

    fireEvent.click(await screen.findByRole('button', { name: /Check IPC mailbox/ }));

    expect(await screen.findByText('Mailbox unreachable')).toBeInTheDocument();
  });
});

