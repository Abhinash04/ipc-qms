import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE, AUDIT_EVENT, BUSINESS_STATUS } from '@/constants/statusEnums';
import { getValidPullbackStages } from '@/constants/pullbackRules';

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

const s = () => useWorkflowStore.getState();

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL_A = findUserById('USR-0004'); // Neha Singh
const ADMIN = findUserById('USR-0008'); // System Administrator (Super Admin)
const REGULAR_ADMIN = findUserById('USR-0007'); // Suresh Gupta (Admin)

const fakeForward = (payload) =>
  Promise.resolve({
    from: 'Test Front Officer <front-office@test.invalid>',
    to: ['officer@test.invalid'],
    subject: `Fwd: ${payload.subject}`,
    body: payload.body,
    providerMessageId: 'mock-msg-forward',
    providerThreadId: payload.providerThreadId || 'mock-thread-1',
    sentAt: '2026-08-18T10:00:00.000Z',
  });

const enquiry = () => ({
  mailboxMessageId: 'MSG-PULL-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
  subject: 'Pullback Functionality Test Query',
  body: 'Testing admin pullback functionality across workflow stages.',
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

describe('Admin Pullback Query Functionality Unit & Integration Tests', () => {
  beforeEach(async () => {
    await setupAssignedQuery();
  });

  describe('Store-level pullBackQuery validation and state updates', () => {
    it('successfully pulls back query to a previous valid stage for Admin', () => {
      const initialQuery = s().getQuery(queryId);
      expect(initialQuery.workflowState).toBe(WORKFLOW_STATE.ASSIGNED);

      // Perform pullback as Admin
      const result = s().pullBackQuery(
        queryId,
        WORKFLOW_STATE.PENDING_ASSIGNMENT,
        'Incorrect assignment',
        'Query assigned to wrong official department.',
        ADMIN,
      );

      expect(result.success).toBe(true);

      const updatedQuery = s().getQuery(queryId);
      expect(updatedQuery.workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(updatedQuery.currentAssigneeId).toBeNull(); // Reset for pre-assignment stage

      // Check pullbackHistory
      expect(updatedQuery.pullbackHistory).toBeDefined();
      expect(updatedQuery.pullbackHistory.length).toBe(1);
      const historyEntry = updatedQuery.pullbackHistory[0];
      expect(historyEntry.fromStage).toBe(WORKFLOW_STATE.ASSIGNED);
      expect(historyEntry.toStage).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(historyEntry.reason).toBe('Incorrect assignment');
      expect(historyEntry.remarks).toBe('Query assigned to wrong official department.');

      // Check audit event
      const auditTrail = s().getAudit(queryId);
      const pullbackAudit = auditTrail.find((a) => a.event === AUDIT_EVENT.QUERY_PULLEDBACK);
      expect(pullbackAudit).toBeDefined();
      expect(pullbackAudit.details).toContain('From: ASSIGNED');
      expect(pullbackAudit.details).toContain('Pulled Back To: PENDING_ASSIGNMENT');
      expect(pullbackAudit.details).toContain('Reason: Incorrect assignment');
    });

    it('refuses pullback when invoked by a non-admin role (e.g. Assigned Official / OIC)', () => {
      expect(() => {
        s().pullBackQuery(
          queryId,
          WORKFLOW_STATE.PENDING_ASSIGNMENT,
          'Unauthorized pullback attempt',
          '',
          OFFICIAL_A,
        );
      }).toThrow(/do not have permission to pull back this query/);

      expect(() => {
        s().pullBackQuery(
          queryId,
          WORKFLOW_STATE.PENDING_ASSIGNMENT,
          'Unauthorized pullback attempt',
          '',
          OIC,
        );
      }).toThrow(/do not have permission to pull back this query/);
    });

    it('refuses pullback when target stage is identical to current workflow stage', () => {
      expect(() => {
        s().pullBackQuery(
          queryId,
          WORKFLOW_STATE.ASSIGNED,
          'Requires correction',
          '',
          ADMIN,
        );
      }).toThrow(/Cannot pull back a query to its current workflow stage/);
    });

    it('reopens a closed query when pulled back by Admin', () => {
      // Manually set query state to CLOSED to test closed pullback
      s().applyTransition({
        queryId,
        actor: ADMIN,
        event: AUDIT_EVENT.QUERY_CLOSED,
        patch: { workflowState: WORKFLOW_STATE.CLOSED, businessStatus: BUSINESS_STATUS.CLOSED },
        details: 'Test query closed.',
      });

      const closedQuery = s().getQuery(queryId);
      expect(closedQuery.workflowState).toBe(WORKFLOW_STATE.CLOSED);
      expect(closedQuery.businessStatus).toBe(BUSINESS_STATUS.CLOSED);

      // Perform pullback as Regular Admin
      s().pullBackQuery(
        queryId,
        WORKFLOW_STATE.UNDER_REVIEW,
        'Requires correction',
        'Reopening closed query for technical revision.',
        REGULAR_ADMIN,
      );

      const reopenedQuery = s().getQuery(queryId);
      expect(reopenedQuery.workflowState).toBe(WORKFLOW_STATE.UNDER_REVIEW);
      expect(reopenedQuery.businessStatus).toBe(BUSINESS_STATUS.IN_PROGRESS);
    });

    it('derives valid pullback target stages based on actual query history', () => {
      const query = s().getQuery(queryId);
      const auditTrail = s().getAudit(queryId);

      const validStages = getValidPullbackStages(query, auditTrail);
      expect(validStages).toContain(WORKFLOW_STATE.RECEIVED);
      expect(validStages).toContain(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
      expect(validStages).toContain(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(validStages).not.toContain(WORKFLOW_STATE.ASSIGNED); // Excludes current state
    });
  });

  describe('UI Integration & Pullback Query Modal Flow', () => {
    it('renders "Pullback Query" button for Admin user and processes modal pullback flow', async () => {
      const { unmount } = renderAs(ADMIN, `/super-admin/queries/${queryId}`);

      // Verify "Pullback Query" button exists for Admin
      const pullbackBtn = screen.getByRole('button', { name: /Pullback Query/i });
      expect(pullbackBtn).toBeInTheDocument();

      // Open Modal
      fireEvent.click(pullbackBtn);

      // Verify Modal Title & Dialog
      expect(screen.getByRole('heading', { name: 'Pullback Query' })).toBeInTheDocument();
      expect(screen.getAllByText(queryId).length).toBeGreaterThan(0);

      // Click "Continue to Pullback"
      const continueBtn = screen.getByRole('button', { name: /Continue to Pullback/i });
      fireEvent.click(continueBtn);

      // Verify Confirmation step is shown
      expect(screen.getByText('Confirm Query Pullback')).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp('Are you sure you want to pull back query')),
      ).toBeInTheDocument();

      // Click "Confirm Pullback"
      const confirmBtn = screen.getByRole('button', { name: /Confirm Pullback/i });
      fireEvent.click(confirmBtn);

      // Verify state update in store
      await waitFor(() => {
        const updated = s().getQuery(queryId);
        expect(updated.workflowState).not.toBe(WORKFLOW_STATE.ASSIGNED);
      });

      unmount();
    });

    it('does NOT render "Pullback Query" button for non-admin official (e.g. Neha Singh)', () => {
      const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/queries/${queryId}`);

      // Verify "Pullback Query" button is NOT rendered for regular official
      expect(screen.queryByRole('button', { name: /Pullback Query/i })).toBeNull();

      unmount();
    });
  });
});
