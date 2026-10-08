import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { fakeCaseMail } from '@/test/fakeCaseMail';
import { AUDIT_EVENT } from '@/constants/statusEnums';

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
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>',
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
  await s().generateAiDraft(queryId, OFFICIAL);

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

describe('removing a review level', () => {
  it('lets the assigned official remove a level that has not started, and records it', () => {
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    renderAt(`/assigned-official/drafting/${queryId}`);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Reviewer I' }));

    expect(s().getSteps(queryId).filter((step) => step.stepType === 'REVIEW')).toHaveLength(0);
    expect(s().getAudit(queryId).at(-1).event).toBe(AUDIT_EVENT.REVIEW_REMOVED);
  });

  it('offers another official neither the remove control nor drafting', () => {
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    useAuthStore.setState({ currentUser: findUserById('USR-0009') });
    renderAt(`/assigned-official/drafting/${queryId}`);

    expect(screen.queryByRole('button', { name: 'Remove Reviewer I' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate AI draft/ })).not.toBeInTheDocument();
  });

  it('refuses a reviewer who calls the store directly', () => {
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    const [level] = s().getSteps(queryId).filter((step) => step.stepType === 'REVIEW');

    expect(() => s().deleteReviewLevel(queryId, level.stepId, REVIEWER_A)).toThrow(
      /may not perform DELETE_REVIEW_LEVEL/,
    );
    expect(s().getSteps(queryId).some((step) => step.stepId === level.stepId)).toBe(true);
  });
});
