import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { fakeCaseMail } from '@/test/fakeCaseMail';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd@example.com', name: 'AR&D Division' },
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

const s = () => useWorkflowStore.getState();

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL_A = findUserById('USR-0004');
const OFFICIAL_B = findUserById('USR-0009');

const caseMail = fakeCaseMail();
const fakeForward = caseMail.forwardQuery;

const enquiry = () => ({
  mailboxMessageId: 'MSG-TRF-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>',
  subject: 'Transfer Functionality Verification Test Query',
  body: 'Testing transfer query between assigned officials.',
  receivedAt: '2026-08-18T09:00:00.000Z',
});

function renderAs(user, path) {
  useAuthStore.setState({ currentUser: user });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let queryId;

async function setupAssignedQuery() {
  await s().hydrate();
  await s().resetDemo();

  ({ queryId } = s().ingestEmail(enquiry()));
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL_A.id, OIC);
}

describe('Transfer Query Functionality Unit & Integration Tests', () => {
  beforeEach(async () => {
    await setupAssignedQuery();
  });

  describe('Store-level transferQuery validation and state updates', () => {
    it('successfully transfers query to another official and preserves workflow state', () => {
      const initialQuery = s().getQuery(queryId);
      expect(initialQuery.currentAssigneeId).toBe(OFFICIAL_A.id);
      expect(initialQuery.workflowState).toBe(WORKFLOW_STATE.ASSIGNED);

      const result = s().transferQuery(
        queryId,
        OFFICIAL_B.id,
        'Query belongs to another department',
        OFFICIAL_A,
      );

      expect(result.success).toBe(true);

      const updatedQuery = s().getQuery(queryId);
      expect(updatedQuery.currentAssigneeId).toBe(OFFICIAL_B.id);
      expect(updatedQuery.workflowState).toBe(WORKFLOW_STATE.ASSIGNED);

      const auditTrail = s().getAudit(queryId);
      const transferAudit = auditTrail.find((a) => a.event === AUDIT_EVENT.QUERY_TRANSFERRED);
      expect(transferAudit).toBeDefined();
      expect(transferAudit.actor).toBe(OFFICIAL_A.name);
      expect(transferAudit.details).toContain(`Case ID: ${queryId}`);
      expect(transferAudit.details).toContain(`Transferred From: ${OFFICIAL_A.name}`);
      expect(transferAudit.details).toContain(`Transferred To: ${OFFICIAL_B.name}`);
      expect(transferAudit.details).toContain('Reason: Query belongs to another department');

      const notifs = s().getNotifications();
      const transferNotif = notifs.find((n) => n.queryId === queryId && n.recipientRole === 'ASSIGNED_OFFICIAL');
      expect(transferNotif).toBeDefined();
      expect(transferNotif.message).toContain(OFFICIAL_B.name);
      expect(transferNotif.message).toContain('Query belongs to another department');
    });

    it('refuses transfer when invoked by an official other than the current assignee', () => {
      const OTHER_OFFICIAL = findUserById('USR-0010');
      expect(() => {
        s().transferQuery(
          queryId,
          OFFICIAL_B.id,
          'Attempting transfer without owning assignment',
          OTHER_OFFICIAL,
        );
      }).toThrow(/Only the currently assigned official/);
    });

    it('refuses transfer when no reason is provided', () => {
      expect(() => {
        s().transferQuery(queryId, OFFICIAL_B.id, '   ', OFFICIAL_A);
      }).toThrow(/A reason for transfer is required/);
    });

    it('refuses transfer to the currently assigned official', () => {
      expect(() => {
        s().transferQuery(
          queryId,
          OFFICIAL_A.id,
          'Workload redistribution',
          OFFICIAL_A,
        );
      }).toThrow(/Cannot transfer a query to the currently assigned official/);
    });
  });

  describe('UI Integration & Transfer Query Modal Flow', () => {
    it('renders "Transfer Query" action for current assignee and processes modal transfer flow', async () => {
      const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/queries/${queryId}`);

      const transferBtn = screen.getByRole('button', { name: /Transfer Query/i });
      expect(transferBtn).toBeInTheDocument();

      fireEvent.click(transferBtn);

      expect(screen.getByRole('heading', { name: 'Transfer Query' })).toBeInTheDocument();
      expect(screen.getAllByText(queryId).length).toBeGreaterThan(0);

      expect(screen.getAllByText(OFFICIAL_A.name).length).toBeGreaterThan(0);

      const officialBOptions = await screen.findAllByText(OFFICIAL_B.name);
      expect(officialBOptions.length).toBeGreaterThan(0);
      fireEvent.click(officialBOptions[0]);

      const continueBtn = screen.getByRole('button', { name: /Continue to Transfer/i });
      fireEvent.click(continueBtn);

      expect(screen.getByText('Confirm Query Transfer')).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp('Are you sure you want to transfer query')),
      ).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /Confirm & Transfer/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        const updated = s().getQuery(queryId);
        expect(updated.currentAssigneeId).toBe(OFFICIAL_B.id);
      });

      unmount();
    });

    it('reflects updated assignee and transfer audit event on Query Detail page for OIC / Super Admin', () => {
      s().transferQuery(queryId, OFFICIAL_B.id, 'Colleague has better expertise', OFFICIAL_A);

      renderAs(OIC, `/officer-in-charge/queries/${queryId}`);

      expect(screen.getAllByText('Assignee').length).toBeGreaterThan(0);
      expect(screen.getAllByText(OFFICIAL_B.name).length).toBeGreaterThan(0);

      expect(screen.getByRole('heading', { name: 'Audit history' })).toBeInTheDocument();
      expect(screen.getByText('QUERY TRANSFERRED')).toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(`Transferred From: ${OFFICIAL_A.name}`)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(`Transferred To: ${OFFICIAL_B.name}`)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(`Reason: Colleague has better expertise`)).length).toBeGreaterThan(0);
    });

    it('transfers query out of Official A active work and into Official B active work', () => {
      const { unmount: unmountA1 } = renderAs(OFFICIAL_A, '/assigned-official/my-work');
      expect(screen.getByText(queryId)).toBeInTheDocument();
      unmountA1();

      s().transferQuery(queryId, OFFICIAL_B.id, 'Workload redistribution', OFFICIAL_A);

      const { unmount: unmountA2 } = renderAs(OFFICIAL_A, '/assigned-official/my-work');
      expect(screen.queryByText(queryId)).toBeNull();
      unmountA2();

      const { unmount: unmountB } = renderAs(OFFICIAL_B, '/assigned-official/my-work');
      expect(screen.getByText(queryId)).toBeInTheDocument();
      unmountB();
    });

    it('displays AI recommended officials in Transfer Query modal and allows selecting a recommendation', async () => {
      const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/queries/${queryId}`);

      const transferBtn = screen.getByRole('button', { name: /Transfer Query/i });
      fireEvent.click(transferBtn);

      expect(await screen.findByText('AI RECOMMENDED OFFICIALS')).toBeInTheDocument();

      const matchBadges = await screen.findAllByText(/% Match/);
      expect(matchBadges.length).toBeGreaterThan(0);

      const aiRecSection = screen.getByText('AI RECOMMENDED OFFICIALS').closest('div');
      expect(aiRecSection.textContent).not.toContain('Neha Singh');

      const recCard = screen.getAllByText(OFFICIAL_B.name)[0].closest('div');
      fireEvent.click(recCard);

      const continueBtn = screen.getByRole('button', { name: /Continue to Transfer/i });
      expect(continueBtn).toBeEnabled();

      unmount();
    });
  });
});
