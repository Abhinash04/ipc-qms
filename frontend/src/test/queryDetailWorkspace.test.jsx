import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({
    from: 'fo@test.invalid',
    to: ['abhinash.pritiraj@pharma.example'],
    subject: 'Acknowledgement of Query Received',
    body: 'Received.',
    sentAt: '2026-08-26T09:30:00.000Z',
    providerMessageId: 'ack-1',
  }),
  forwardQuery: vi.fn().mockResolvedValue({
    from: 'fo@test.invalid',
    to: ['oic@test.invalid'],
    subject: 'Fwd',
    body: 'forwarded',
    sentAt: '2026-08-26T09:45:00.000Z',
    providerMessageId: 'fwd-1',
  }),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');

const s = () => useWorkflowStore.getState();

const enquiry = () => ({
  mailboxMessageId: 'MSG-WS-1',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Sterility testing clarification',
  body: 'Please clarify the applicable endotoxin limits.',
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

const grid = () =>
  document.querySelector('[class*="lg:grid-cols-[minmax(0,1fr)_340px]"]');

const threadPanel = () =>
  screen.getByRole('heading', { name: 'Email thread' }).closest('div.rounded-3xl');

const collapsedRows = () =>
  within(threadPanel()).queryAllByRole('button', { expanded: false });

const expandedMessages = () => threadPanel().querySelectorAll('article').length;

const officialsPanel = () =>
  screen.getByRole('heading', { name: 'Officials' }).closest('div.rounded-3xl');

let queryId;

function received() {
  ({ queryId } = s().ingestEmail(enquiry(), async () => null));
  return queryId;
}

async function underReview() {
  received();
  await s().validateAndForward(queryId, FRONT_OFFICE);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
  return queryId;
}

beforeEach(async () => {
  vi.clearAllMocks();
  installFakeCaseMail(mailboxService);
  await s().hydrate();
  await s().resetDemo();
});

describe('the page is one workspace, not a long document', () => {
  it('puts the content and the action panel in a single grid', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(grid()).not.toBeNull();
    expect(grid().className).toMatch(/items-start/);
  });

  it('sticks the action panel so it survives a long thread', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    const panel = screen
      .getByRole('heading', { name: 'Available actions' })
      .closest('[class*="sticky"]');
    expect(panel).not.toBeNull();
    expect(panel.className).toMatch(/overflow-y-auto/);
  });

});

describe('the email thread reads like a conversation', () => {
  it('expands only the newest message and collapses the rest', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    const total = s().emailMessages.filter((m) => m.queryId === queryId).length;
    expect(total).toBeGreaterThan(1);

    expect(expandedMessages()).toBe(1);
    expect(
      within(threadPanel()).getByRole('button', { name: /Show \d+ previous messages?/ }),
    ).toBeInTheDocument();
  });

  it('reveals earlier messages, then expands one on click', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    fireEvent.click(
      within(threadPanel()).getByRole('button', { name: /Show \d+ previous messages?/ }),
    );
    const rows = collapsedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(expandedMessages()).toBe(1);

    fireEvent.click(rows[0]);
    expect(expandedMessages()).toBe(2);
    expect(collapsedRows()).toHaveLength(rows.length - 1);
  });

  it('collapses an opened message again', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    fireEvent.click(
      within(threadPanel()).getByRole('button', { name: /Show \d+ previous messages?/ }),
    );
    fireEvent.click(collapsedRows()[0]);
    expect(expandedMessages()).toBe(2);

    fireEvent.click(
      within(threadPanel()).getAllByRole('button', { name: 'Collapse message' })[0],
    );
    expect(expandedMessages()).toBe(1);
  });

  it('keeps the direction filter working alongside collapse', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    const inbound = s().emailMessages.filter(
      (m) => m.queryId === queryId && m.direction === 'INBOUND',
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Received Only' }));
    expect(expandedMessages()).toBe(1);
    expect(collapsedRows().length + expandedMessages()).toBeLessThanOrEqual(inbound + 1);

    fireEvent.click(screen.getByRole('button', { name: 'All Emails' }));
    expect(expandedMessages()).toBe(1);
  });
});

describe('Officials shows who is handling the case', () => {
  it('names the real chain with their statuses', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    const panel = within(officialsPanel());
    expect(panel.getByText(INQUIRER.name)).toBeInTheDocument();
    expect(panel.getByText(FRONT_OFFICE.name)).toBeInTheDocument();
    expect(panel.getByText(OFFICIAL.name)).toBeInTheDocument();
    expect(panel.getByText(REVIEWER.name)).toBeInTheDocument();
    expect(panel.getAllByText('Current').length).toBeGreaterThan(0);
  });

  it('still renders on a freshly received query, before anyone is assigned', () => {
    received();
    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);

    const panel = within(officialsPanel());
    expect(panel.getByText('Front Office')).toBeInTheDocument();
    expect(panel.getAllByText('Pending').length).toBeGreaterThan(0);
  });
});

describe('AI recommendations only appear while they are useful', () => {
  it('offers them to the OIC while assignment is still open', async () => {
    received();
    await s().validateAndForward(queryId, FRONT_OFFICE);
    renderAs(OIC, `/officer-in-charge/queries/${queryId}`);

    expect(
      screen.getByRole('heading', { name: /AI Official Recommendations/ }),
    ).toBeInTheDocument();
  });

  it('drops them once the case is assigned, leaving Officials to answer', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.queryByRole('heading', { name: /AI Official Recommendations/ })).toBeNull();
    expect(officialsPanel()).not.toBeNull();
  });
});

describe('audit history is bounded but complete', () => {
  it('shows the newest events first and reveals the rest on demand', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    const total = s().auditEvents.filter((e) => e.queryId === queryId).length;
    expect(total).toBeGreaterThan(8);

    const auditCard = screen
      .getByRole('heading', { name: 'Audit history' })
      .closest('div.rounded-3xl');
    expect(within(auditCard).getAllByRole('row')).toHaveLength(8 + 1);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Show all ${total} events`) }));
    expect(within(auditCard).getAllByRole('row')).toHaveLength(total + 1);
  });
});

describe('nothing was lost to the restructure', () => {
  it('keeps every reviewer control and every tab', async () => {
    await underReview();
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.getByRole('button', { name: /Review draft/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete review level/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();

    expect(screen.getByRole('tab', { name: 'Response Draft' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Query Info' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Attachments' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Case details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflow progress' })).toBeInTheDocument();
  });

});
