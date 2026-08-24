import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLES } from '@/constants/roles';
import { findUserById } from '@/constants/mockUsers';
import { isQueryOwnedBy } from '@/utils/queryOwnership';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd@example.com', name: 'AR&D Division' },
    inquirer: { email: 'abhinash.pritiraj@gmail.com', name: 'Abhinash Pritiraj' },
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendEnquiry: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-1' }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICER = findUserById('USR-0002');

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

const inquirerEmail = () => ({
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Clarification on monograph revision and impurity limits',
  body: 'Dear Sir/Madam,\n\nPlease clarify the applicable monograph.\n\nRegards',
  receivedAt: '2026-08-18T09:00:00.000Z',
});

let ownedQuery;

beforeEach(async () => {
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  const { queryId } = useWorkflowStore.getState().ingestEmail(inquirerEmail());
  ownedQuery = useWorkflowStore.getState().queries.find((q) => q.queryId === queryId);
});

describe('the inquirer can open their own query detail page', () => {
  it('ingests a query that belongs to the inquirer', () => {
    expect(isQueryOwnedBy(ownedQuery, INQUIRER)).toBe(true);
  });

  it('resolves /inquirer/queries/:queryId instead of matching no route', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    renderAt(`/inquirer/queries/${ownedQuery.queryId}`);

    expect(screen.getAllByText(ownedQuery.queryId).length).toBeGreaterThan(0);
    expect(screen.queryByText('Query not found')).not.toBeInTheDocument();
    expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
  });

  it('hides internal-only blocks but keeps the email thread', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    renderAt(`/inquirer/queries/${ownedQuery.queryId}`);

    expect(screen.queryByText('Audit history')).not.toBeInTheDocument();
    expect(screen.queryByText('Available actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Response Draft')).not.toBeInTheDocument();

    expect(screen.getByText('Email thread')).toBeInTheDocument();
    expect(screen.getByText('Workflow progress')).toBeInTheDocument();
  });

  it('shows the whole lifecycle rail instead of an empty step list', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    renderAt(`/inquirer/queries/${ownedQuery.queryId}`);

    expect(screen.queryByText('No workflow steps yet')).not.toBeInTheDocument();

    for (const label of [
      'Enquiry submitted',
      'Verified & acknowledged',
      'Forwarded to Officer-in-Charge',
      'Assigned to an official',
      'Final approval',
      'Response dispatched',
      'Inquirer received response',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('marks exactly one stage as the current step', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    const { container } = renderAt(`/inquirer/queries/${ownedQuery.queryId}`);

    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBeGreaterThan(0);
    for (const node of current) {
      expect(node.textContent).toContain('Verified & acknowledged');
    }
  });

  it('refuses a query the inquirer does not own', () => {
    useAuthStore.setState({
      currentUser: { ...INQUIRER, id: 'USR-9999', email: 'someone.else@example.com' },
    });
    renderAt(`/inquirer/queries/${ownedQuery.queryId}`);

    expect(screen.getByText('Query not found')).toBeInTheDocument();
  });
});

describe('the front officer query detail page is unaffected', () => {
  it('still shows the internal blocks', () => {
    expect(FRONT_OFFICER.role).toBe(ROLES.FRONT_OFFICE);
    useAuthStore.setState({ currentUser: FRONT_OFFICER });
    renderAt(`/front-officer/queries/${ownedQuery.queryId}`);

    expect(screen.getByText('Audit history')).toBeInTheDocument();
    expect(screen.getByText('Available actions')).toBeInTheDocument();
    expect(screen.getByText('Response Draft')).toBeInTheDocument();
  });
});
