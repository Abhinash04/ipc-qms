import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { WORKFLOW_STATE, AUDIT_EVENT, BUSINESS_STATUS } from '@/constants/statusEnums';
import { getValidPullbackStages } from '@/constants/pullbackRules';
import { fakeCaseMail } from '@/test/fakeCaseMail';
import { fakeFinalApprovalEndpoint } from '@/test/fakeFinalApprovalEndpoint';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

const s = () => useWorkflowStore.getState();

const OIC = findUserById('USR-0003');
const OFFICIAL_A = findUserById('USR-0004');
const ADMIN = findUserById('USR-0008');
const REGULAR_ADMIN = findUserById('USR-0007');

const caseMail = fakeCaseMail();
const fakeForward = caseMail.forwardQuery;

const enquiry = () => ({
  mailboxMessageId: 'MSG-PULL-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>',
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
    it('successfully pulls back query to a previous valid stage for Admin', async () => {
      const initialQuery = s().getQuery(queryId);
      expect(initialQuery.workflowState).toBe(WORKFLOW_STATE.ASSIGNED);

      const result = await s().pullBackQuery(
        queryId,
        WORKFLOW_STATE.PENDING_ASSIGNMENT,
        'Incorrect assignment',
        'Query assigned to wrong official department.',
        ADMIN,
      );

      expect(result.success).toBe(true);

      const updatedQuery = s().getQuery(queryId);
      expect(updatedQuery.workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(updatedQuery.currentAssigneeId).toBeNull();

      expect(updatedQuery.pullbackHistory).toBeDefined();
      expect(updatedQuery.pullbackHistory.length).toBe(1);
      const historyEntry = updatedQuery.pullbackHistory[0];
      expect(historyEntry.fromStage).toBe(WORKFLOW_STATE.ASSIGNED);
      expect(historyEntry.toStage).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(historyEntry.reason).toBe('Incorrect assignment');
      expect(historyEntry.remarks).toBe('Query assigned to wrong official department.');

      const auditTrail = s().getAudit(queryId);
      const pullbackAudit = auditTrail.find((a) => a.event === AUDIT_EVENT.QUERY_PULLED_BACK);
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

    it('refuses to reopen a query once it is closed — the response has already gone out', () => {
      s().applyTransition({
        queryId,
        actor: ADMIN,
        event: AUDIT_EVENT.QUERY_CLOSED,
        patch: { workflowState: WORKFLOW_STATE.CLOSED, businessStatus: BUSINESS_STATUS.CLOSED },
        details: 'Test query closed.',
      });

      expect(() =>
        s().pullBackQuery(
          queryId,
          WORKFLOW_STATE.DRAFTING,
          'Requires correction',
          'Reopening closed query for technical revision.',
          REGULAR_ADMIN,
        ),
      ).toThrow(/cannot be pulled back once it has been finally approved or dispatched/);
      expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    });

    it('derives valid pullback target stages based on actual query history', () => {
      const query = s().getQuery(queryId);
      const auditTrail = s().getAudit(queryId);

      const validStages = getValidPullbackStages(query, auditTrail);
      expect(validStages).toContain(WORKFLOW_STATE.RECEIVED);
      expect(validStages).toContain(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
      expect(validStages).toContain(WORKFLOW_STATE.PENDING_ASSIGNMENT);
      expect(validStages).not.toContain(WORKFLOW_STATE.ASSIGNED);
    });
  });

  describe('UI Integration & Pullback Query Modal Flow', () => {
    it('renders "Pullback Query" button for Admin user and processes modal pullback flow', async () => {
      const { unmount } = renderAs(ADMIN, `/super-admin/queries/${queryId}`);

      const pullbackBtn = screen.getByRole('button', { name: /Pullback Query/i });
      expect(pullbackBtn).toBeInTheDocument();

      fireEvent.click(pullbackBtn);

      expect(screen.getByRole('heading', { name: 'Pullback Query' })).toBeInTheDocument();
      expect(screen.getAllByText(queryId).length).toBeGreaterThan(0);

      const continueBtn = screen.getByRole('button', { name: /Continue to Pullback/i });
      fireEvent.click(continueBtn);

      expect(screen.getByText('Confirm Query Pullback')).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp('Are you sure you want to pull back query')),
      ).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /Confirm Pullback/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        const updated = s().getQuery(queryId);
        expect(updated.workflowState).not.toBe(WORKFLOW_STATE.ASSIGNED);
      });

      unmount();
    });

    it('does NOT render "Pullback Query" button for non-admin official (e.g. Neha Singh)', () => {
      const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/queries/${queryId}`);

      expect(screen.queryByRole('button', { name: /Pullback Query/i })).toBeNull();

      unmount();
    });
  });
});

describe('the pull back dialog across a review cycle', () => {
  const AMIT = findUserById('USR-0005');
  const KAVITA = findUserById('USR-0006');

  async function toFinalApproval() {
    await setupAssignedQuery();
    s().saveDraftVersion(queryId, 'Response v1', OFFICIAL_A);
    s().addReviewLevel(queryId, AMIT.id, OFFICIAL_A);
    s().addReviewLevel(queryId, KAVITA.id, OFFICIAL_A);
    s().submitForReview(queryId, OFFICIAL_A);
    s().approveReview(queryId, 'ok', AMIT);
    s().approveReview(queryId, 'ok', KAVITA);
  }

  it('offers each review level as a target, and resumes review at the one chosen', async () => {
    await toFinalApproval();
    const { unmount } = renderAs(ADMIN, `/super-admin/queries/${queryId}`);

    fireEvent.click(screen.getByRole('button', { name: /Pullback Query/i }));
    const select = screen.getByLabelText(/Pull Back To/i);
    const options = [...select.querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual([
      'IPC Mailbox / Intake',
      'Front Officer Validation / Registration',
      'Forwarded to Officer-in-Charge',
      'Assigned to Official',
      'Drafting Response',
      'Review / Action — Reviewer I (Amit Mehta)',
      'Review / Action — Reviewer II (Kavita Rao)',
    ]);

    const level = [...select.querySelectorAll('option')].find((option) => option.textContent.includes('Reviewer II'));
    fireEvent.change(select, { target: { value: level.value } });
    fireEvent.click(screen.getByRole('button', { name: /Continue to Pullback/i }));
    expect(screen.getByText('Review / Action — Reviewer II (Kavita Rao)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Pullback/i }));

    await waitFor(() => expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.UNDER_REVIEW));
    expect(s().getCurrentStep(queryId)).toMatchObject({ assignedUserId: KAVITA.id, status: 'IN_PROGRESS' });
    unmount();
  });

  it('no longer offers pull back once the query is closed', async () => {
    await toFinalApproval();
    await s().grantFinalApproval(queryId, OIC, fakeFinalApprovalEndpoint());

    const { unmount } = renderAs(ADMIN, `/super-admin/queries/${queryId}`);

    expect(screen.queryByRole('button', { name: /Pullback Query/i })).toBeNull();
    unmount();
  });

  it('shows the official an empty review chain, with the old one as history only', async () => {
    await toFinalApproval();
    await s().pullBackQuery(queryId, WORKFLOW_STATE.DRAFTING, 'Requires correction', '', ADMIN);

    const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/drafting/${queryId}`);

    expect(
      screen.getByText('No reviewer chosen yet — the draft cannot be submitted until you add one.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add Reviewer I')).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'Review cycle 1' });
    expect(history).toHaveTextContent('Reviewer I');
    expect(history).toHaveTextContent('Amit Mehta');
    expect(history).toHaveTextContent('Reviewer II');
    expect(history).toHaveTextContent('Kavita Rao');
    unmount();
  });
});
