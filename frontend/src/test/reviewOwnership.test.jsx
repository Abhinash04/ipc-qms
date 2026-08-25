import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

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
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');

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
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
  subject: 'Clarification on monograph revision',
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

const decisionButtons = () => [
  screen.queryByRole('button', { name: 'Approve' }),
  screen.queryByRole('button', { name: 'Return for revision' }),
];

let queryId;

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();

  ({ queryId } = s().ingestEmail(enquiry()));
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
});

describe('the review detail page only offers a decision to the assigned reviewer', () => {
  it('gives Reviewer I the Approve and Return controls at level 1', () => {
    renderAs(REVIEWER_A, `/reviewer/reviews/${queryId}`);

    const [approve, ret] = decisionButtons();
    expect(approve).toBeInTheDocument();
    expect(ret).toBeInTheDocument();
  });

  it('withholds them from Reviewer II and names whose level it is', () => {
    renderAs(REVIEWER_B, `/reviewer/reviews/${queryId}`);

    expect(decisionButtons()).toEqual([null, null]);
    expect(
      screen.getByText(new RegExp(`This level is assigned to ${REVIEWER_A.name}`)),
    ).toBeInTheDocument();
  });

  it('hands the controls over once Reviewer I approves', () => {
    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);

    renderAs(REVIEWER_B, `/reviewer/reviews/${queryId}`);
    const [approve, ret] = decisionButtons();
    expect(approve).toBeInTheDocument();
    expect(ret).toBeInTheDocument();
  });

  it('takes the controls away from Reviewer I once they have approved', () => {
    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);

    renderAs(REVIEWER_A, `/reviewer/reviews/${queryId}`);
    expect(decisionButtons()).toEqual([null, null]);
    expect(
      screen.getByText(new RegExp(`This level is assigned to ${REVIEWER_B.name}`)),
    ).toBeInTheDocument();
  });
});

describe('the reviews list shows only what the reviewer can act on', () => {
  it('lists the case for Reviewer I and nothing for Reviewer II at level 1', () => {
    const { unmount } = renderAs(REVIEWER_A, '/reviewer/reviews');
    expect(screen.getByText(queryId)).toBeInTheDocument();
    unmount();

    renderAs(REVIEWER_B, '/reviewer/reviews');
    expect(screen.queryByText(queryId)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing is waiting on you/)).toBeInTheDocument();
  });

  it('swaps them over when the level advances', () => {
    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);

    const { unmount } = renderAs(REVIEWER_A, '/reviewer/reviews');
    expect(screen.queryByText(queryId)).not.toBeInTheDocument();
    unmount();

    renderAs(REVIEWER_B, '/reviewer/reviews');
    expect(screen.getByText(queryId)).toBeInTheDocument();
  });

  it('drops the case for both once it leaves review', () => {
    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);
    s().approveReview(queryId, 'Level 2 fine', REVIEWER_B);

    const { unmount } = renderAs(REVIEWER_A, '/reviewer/reviews');
    expect(screen.queryByText(queryId)).not.toBeInTheDocument();
    unmount();

    renderAs(REVIEWER_B, '/reviewer/reviews');
    expect(screen.queryByText(queryId)).not.toBeInTheDocument();
  });
});
