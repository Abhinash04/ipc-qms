import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';

vi.mock('@/services/api/adminService', () => ({
  fetchAuditSummary: vi.fn().mockResolvedValue({ backend: 'mongo', durable: true, total: 0, byResult: {} }),
  fetchAuditEvents: vi.fn().mockResolvedValue({ events: [] }),
  fetchQueryAudit: vi.fn().mockResolvedValue({ events: [] }),
}));
vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy', service: 'qms-backend' }),
}));
vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn(),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  sendAcknowledgement: vi.fn(),
  forwardQuery: vi.fn(),
  sendResponse: vi.fn(),
}));

import { fetchEmailConfig } from '@/services/api/mailboxService';

const SUPER_ADMIN = findUserById('USR-0008');

const config = (over = {}) => ({
  transport: 'mock',
  nicBrowserMailbox: false,
  outboundAllowed: false,
  ipcQueryEmail: 'front-office@test.invalid',
  participants: [],
  ...over,
});

async function renderSettings(over = {}) {
  fetchEmailConfig.mockResolvedValue(config(over));
  useAuthStore.setState({ currentUser: SUPER_ADMIN, authReady: true });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/super-admin/administration/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText('Transport')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the email panel states what actually leaves the machine', () => {
  it('says the mock transport delivers nothing', async () => {
    await renderSettings({ transport: 'mock' });

    expect(screen.getByText(/Delivers nothing/i)).toBeInTheDocument();
  });

  it('says NICeMail SMTP sends real mail', async () => {
    await renderSettings({ transport: 'nic' });

    expect(screen.getByText(/Real mail leaves this machine/i)).toBeInTheDocument();
  });

  it('reports the NICeMail agent even when the transport is mock', async () => {
    await renderSettings({ transport: 'mock', nicBrowserMailbox: true });

    expect(screen.getByText('NICeMail browser agent')).toBeInTheDocument();
    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(
      screen.getByText(/sent from that account, whatever the transport above says/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing leaves this machine/i)).not.toBeInTheDocument();
  });

  it('shows the outbound interlock only while the agent is enabled', async () => {
    await renderSettings({ nicBrowserMailbox: true, outboundAllowed: false });

    expect(screen.getByText('Outbound interlock')).toBeInTheDocument();
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(screen.getByText(/confined to the configured test recipient/i)).toBeInTheDocument();
  });

  it('warns when the interlock is open', async () => {
    await renderSettings({ nicBrowserMailbox: true, outboundAllowed: true });

    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText(/may reach any recipient/i)).toBeInTheDocument();
  });

  it('assumes an unrecognised transport sends, rather than assuming it is safe', async () => {
    await renderSettings({ transport: 'carrier-pigeon' });

    expect(screen.getByText(/assume real mail leaves this machine/i)).toBeInTheDocument();
  });

  it('never claims a participant is send-capable — the server stopped reporting that', async () => {
    await renderSettings({
      participants: [{ role: 'FRONT_OFFICE', name: 'Test Front Officer', email: 'fo@test.invalid' }],
    });

    expect(screen.getByText('Test Front Officer')).toBeInTheDocument();
    expect(screen.getByText('fo@test.invalid')).toBeInTheDocument();
    expect(screen.queryByText('mock only')).not.toBeInTheDocument();
    expect(screen.queryByText('can send')).not.toBeInTheDocument();
  });
});
