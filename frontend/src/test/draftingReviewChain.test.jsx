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

const submitButton = () => screen.getByRole('button', { name: 'Submit for review' });

let queryId;

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();

  ({ queryId } = s().ingestEmail(enquiry()));
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  s().generateAiDraft(queryId, OFFICIAL);

  useAuthStore.setState({ currentUser: OFFICIAL });
});

describe('the drafting page gates submission on a review chain', () => {
  it('refuses to submit while no reviewer has been chosen', () => {
    renderAt(`/assigned-official/drafting/${queryId}`);

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAttribute('title', 'Add at least one review level first');
    expect(
      screen.getByText(/No reviewer chosen yet — the draft cannot be submitted/),
    ).toBeInTheDocument();
  });

  it('enables submission once a reviewer is on the chain', () => {
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    renderAt(`/assigned-official/drafting/${queryId}`);

    expect(submitButton()).toBeEnabled();
    expect(submitButton()).not.toHaveAttribute('title');
  });

  it('names the levels Reviewer I and Reviewer II in chain order', () => {
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
    renderAt(`/assigned-official/drafting/${queryId}`);

    expect(screen.getByText('Reviewer I')).toBeInTheDocument();
    expect(screen.getByText(REVIEWER_A.name)).toBeInTheDocument();
    expect(screen.getByText('Reviewer II')).toBeInTheDocument();
    expect(screen.getByText(REVIEWER_B.name)).toBeInTheDocument();
    expect(screen.getByText('Add Reviewer III')).toBeInTheDocument();
  });
});
