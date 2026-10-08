import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { fakeCaseMail } from '@/test/fakeCaseMail';

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
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');

const caseMail = fakeCaseMail();
const fakeForward = caseMail.forwardQuery;

const enquiry = () => ({
  mailboxMessageId: 'MSG-REV-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>',
  subject: 'Monograph Review Flow Verification',
  body: 'Please clarify the applicable monograph.',
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

function tile(label) {
  const labelEl = screen
    .getAllByText(label)
    .find((el) => el.matches('[data-slot="stat-label"]'));
  return labelEl.closest('.bento-card');
}

function tileCount(label) {
  const el = tile(label).querySelector('[data-slot="stat-value"]');
  return Number(el.textContent.trim());
}

let queryId;

async function setupSubmittedReview() {
  await s().hydrate();
  await s().resetDemo();

  ({ queryId } = s().ingestEmail(enquiry()));
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
}

describe('End-to-end reviewer flow and role dashboard reactivity', () => {
  beforeEach(async () => {
    await setupSubmittedReview();
  });

  it('populates Reviewer A dashboard while keeping Reviewer B queue clean', () => {
    const { unmount: unmountA } = renderAs(REVIEWER_A, '/reviewer/dashboard');
    expect(tileCount('Awaiting My Review')).toBe(1);
    expect(screen.getByText(queryId)).toBeInTheDocument();
    unmountA();

    const { unmount: unmountB } = renderAs(REVIEWER_B, '/reviewer/dashboard');
    expect(tileCount('Awaiting My Review')).toBe(0);
    expect(screen.queryByText(queryId)).toBeNull();
    expect(screen.getByText(/Your review queue is empty/)).toBeInTheDocument();
    unmountB();
  });

  it('allows Reviewer A to approve on QueryDetailPage, advancing state to PENDING_FINAL_APPROVAL', async () => {
    const { unmount: unmountDetail } = renderAs(REVIEWER_A, `/reviewer/queries/${queryId}`);

    expect(screen.getByRole('heading', { name: 'Review decision' })).toBeInTheDocument();
    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    const requestBtn = screen.getByRole('button', { name: 'Request changes' });

    expect(approveBtn).toBeInTheDocument();
    expect(requestBtn).toBeInTheDocument();

    fireEvent.click(approveBtn);
    const dialog = screen.getByRole('dialog', { name: 'Approve review' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(s().queries.find((q) => q.queryId === queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL),
    );
    unmountDetail();

    const { unmount: unmountDash } = renderAs(REVIEWER_A, '/reviewer/dashboard');
    expect(tileCount('Awaiting My Review')).toBe(0);
    expect(tileCount('Approved by me')).toBe(1);
    unmountDash();

    const { unmount: unmountOic } = renderAs(OIC, '/officer-in-charge/dashboard');
    expect(tileCount('Awaiting Final Approval')).toBe(1);
    expect(screen.getAllByText(queryId).length).toBeGreaterThan(0);
    unmountOic();
  });

  it('allows Reviewer A to request changes with comment, returning query to official', async () => {
    const { unmount: unmountDetail } = renderAs(REVIEWER_A, `/reviewer/queries/${queryId}`);

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Request changes' });
    const send = within(dialog).getByRole('button', { name: 'Request changes' });
    expect(send).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Changes required' }), {
      target: { value: 'Please update testing limits according to revised monograph.' },
    });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() =>
      expect(s().queries.find((q) => q.queryId === queryId).workflowState).toBe(WORKFLOW_STATE.RETURNED_FOR_REVISION),
    );
    unmountDetail();

    const { unmount: unmountReviewerDash } = renderAs(REVIEWER_A, '/reviewer/dashboard');
    expect(tileCount('Awaiting My Review')).toBe(0);
    expect(tileCount('Returned by me')).toBe(1);
    unmountReviewerDash();

    const { unmount: unmountOfficialDash } = renderAs(OFFICIAL, '/assigned-official/dashboard');
    expect(tileCount('Returned for Revision')).toBe(1);
    expect(screen.getAllByText(queryId).length).toBeGreaterThan(0);
    unmountOfficialDash();
  });

  it('withholds decision controls from Reviewer B and displays assignment notice', () => {
    renderAs(REVIEWER_B, `/reviewer/queries/${queryId}`);

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
    expect(
      screen.getByText(new RegExp(`This level is assigned to ${REVIEWER_A.name}`)),
    ).toBeInTheDocument();
  });
});
