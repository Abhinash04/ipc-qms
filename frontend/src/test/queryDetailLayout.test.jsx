import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import * as mailboxService from '@/services/api/mailboxService';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

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

const detailGrid = () =>
  document.querySelector('[class*="lg:grid-cols-[minmax(0,1fr)_340px]"]');

const actionsCard = () =>
  screen.getByRole('heading', { name: 'Available actions' }).closest('div.rounded-3xl');

let queryId;

async function caseUnderReview() {
  ({ queryId } = s().ingestEmail(enquiry(), async () => null));
  await s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE);
  s().assignQuery(queryId, OFFICIAL.id, findUserById('USR-0003'));
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
}

beforeEach(async () => {
  vi.clearAllMocks();
  installFakeCaseMail(mailboxService);
  await s().hydrate();
  await s().resetDemo();
  await caseUnderReview();
});

describe('the detail columns size to their own content', () => {
  it('does not let one column stretch the other', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(detailGrid().className).toMatch(/items-start/);
  });

  it('lets the actions card end at its last button', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(actionsCard().className).not.toMatch(/h-full/);
  });
});

describe('the front officer case page shows the internal blocks', () => {
  it('renders the draft, the actions and the audit trail', () => {
    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);

    expect(screen.getByText('Audit history')).toBeInTheDocument();
    expect(screen.getByText('Available actions')).toBeInTheDocument();
    expect(screen.getByText('Response Draft')).toBeInTheDocument();
  });
});

describe('nothing was lost to the compaction', () => {
  it('still shows the timeline, every action, and the review decision card', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.getAllByText('Enquiry submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Forwarded to Officer-in-Charge').length).toBeGreaterThan(0);

    expect(screen.getByRole('heading', { name: 'Available actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review draft/ })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Transfer query/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pull back query/ })).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Review decision' })).toBeInTheDocument();
  });

  it('keeps the Front Office actions intact on an accepted query', async () => {
    const { queryId: fresh } = s().ingestEmail(
      { ...enquiry(), mailboxMessageId: 'MSG-LAYOUT-2' },
      async () => null,
    );
    await s().verifyQuery(fresh, FRONT_OFFICE);

    renderAs(FRONT_OFFICE, `/front-officer/queries/${fresh}`);

    expect(screen.queryByRole('button', { name: /Validate Query/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Forward to Officer-in-Charge/ }),
    ).toBeInTheDocument();
    expect(actionsCard().className).not.toMatch(/h-full/);
  });

});
