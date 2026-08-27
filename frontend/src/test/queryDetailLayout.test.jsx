import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

/**
 * jsdom computes no layout, so these pin the structural rules that caused the
 * whitespace rather than measuring pixels. The content assertions are the ones
 * that prove the compaction removed space and not functionality.
 */

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');

const s = () => useWorkflowStore.getState();

const enquiry = () => ({
  mailboxMessageId: 'MSG-LAYOUT-1',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Sterility testing clarification',
  body: 'Please clarify the applicable limits.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const fakeForward = () =>
  Promise.resolve({
    from: 'fo@test.invalid',
    to: ['oic@test.invalid'],
    subject: 'Fwd',
    body: 'x',
    sentAt: '2026-08-26T10:00:00.000Z',
    providerMessageId: 'fwd-1',
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

/** The workspace grid that holds the content column and the action panel. */
const detailGrid = () =>
  document.querySelector('[class*="lg:grid-cols-[minmax(0,1fr)_340px]"]');

const actionsCard = () =>
  screen.getByRole('heading', { name: 'Available actions' }).closest('div.rounded-3xl');

let queryId;

/** Drive a case to UNDER_REVIEW so the reviewer sees both right-hand cards. */
async function caseUnderReview() {
  ({ queryId } = s().ingestEmail(enquiry(), async () => null));
  await s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, findUserById('USR-0003'));
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await s().hydrate();
  await s().resetDemo();
  await caseUnderReview();
});

describe('the detail columns size to their own content', () => {
  it('does not let one column stretch the other', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    // Without items-start the grid stretches both columns to the taller one,
    // which dragged the Workflow progress card far past its timeline.
    expect(detailGrid().className).toMatch(/items-start/);
  });

  it('lets the actions card end at its last button', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    // h-full made this card fill the stretched row instead of its content.
    expect(actionsCard().className).not.toMatch(/h-full/);
  });
});

describe('nothing was lost to the compaction', () => {
  it('still shows the timeline, every action, and the review decision card', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    // Timeline stages (both layouts are in the DOM, so match all).
    expect(screen.getAllByText('Enquiry submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Forwarded to Officer-in-Charge').length).toBeGreaterThan(0);

    // Every control the reviewer had before.
    expect(screen.getByRole('heading', { name: 'Available actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review draft/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Transfer query/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pull back query/ })).toBeInTheDocument();

    // The second right-hand card, which is what made the column tall.
    expect(screen.getByRole('heading', { name: 'Review decision' })).toBeInTheDocument();
  });

  it('keeps the Front Office actions intact on a fresh query', async () => {
    const { queryId: fresh } = s().ingestEmail(
      { ...enquiry(), mailboxMessageId: 'MSG-LAYOUT-2' },
      async () => null,
    );

    renderAs(FRONT_OFFICE, `/front-officer/queries/${fresh}`);

    expect(screen.getByRole('button', { name: /Validate Query/ })).toBeInTheDocument();
    expect(actionsCard().className).not.toMatch(/h-full/);
  });

  it('renders the single-column inquirer view with no actions column', () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);

    expect(screen.getAllByText('Enquiry submitted').length).toBeGreaterThan(0);
    // The inquirer never had the actions card; that must not have changed.
    expect(screen.queryByRole('heading', { name: 'Available actions' })).toBeNull();
    expect(detailGrid()).toBeNull();
  });
});
