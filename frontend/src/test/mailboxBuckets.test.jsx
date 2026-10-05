import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import {
  fetchMailboxMessages,
  fetchMailboxDecisions,
  recordMailboxDecision,
  acceptMailboxMessage,
  deleteMailboxMessage,
  markMessageIngested,
  sendAcknowledgement,
  forwardQuery,
} from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  setMailboxMessageCategory: vi.fn().mockResolvedValue({ corrected: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn(),
  fetchMailboxMessage: vi.fn().mockResolvedValue(null),
  markMailboxMessageRead: vi.fn().mockResolvedValue({}),
  syncMailbox: vi.fn(),
  mailboxAttachmentUrl: vi.fn(),
  fetchMailboxDecisions: vi.fn(),
  recordMailboxDecision: vi.fn(),
  acceptMailboxMessage: vi.fn(),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
}));


const ACK_RESULT = {
  from: 'Front Office <front-office@test.invalid>',
  to: ['someone@example.com'],
  subject: 'Acknowledgement',
  body: 'Received.',
  sentAt: '2026-08-18T09:05:00.000Z',
  providerMessageId: 'ack-1',
};

const message = (n, subject, from = 'Ravi Kumar <ravi@pharma.example>') => ({
  mailboxMessageId: `MSG-0000${n}`,
  to: 'ipc-query-mock@example.com',
  from,
  subject,
  body: 'Body text.',
  receivedAt: '2026-08-18T09:00:00.000Z',
  ingested: false,
});

const acceptFor = (id) => screen.getByRole('button', { name: `Accept message ${id}` });
const rejectFor = (id) => screen.getByRole('button', { name: `Reject message ${id}` });

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MailboxInboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMailboxDecisions.mockResolvedValue({ decisions: [] });
  recordMailboxDecision.mockResolvedValue({ alreadyDecided: false });
  acceptMailboxMessage.mockImplementation(fakeAcceptEndpoint());
  deleteMailboxMessage.mockResolvedValue({ deleted: true });
  markMessageIngested.mockResolvedValue({ ingested: true });
  sendAcknowledgement.mockResolvedValue(ACK_RESULT);
  forwardQuery.mockResolvedValue({});
  fetchMailboxMessages.mockResolvedValue({
    backend: 'nic-browser',
    bucketCounts: { all: 3, auto_reply: 1, human: 2 },
    categoryCounts: { OFFICIAL_QUERY: 3 },
    messages: [
      {
        ...message(1, 'Paracetamol'),
        autoReply: { status: 'SUGGESTED', topic: 'Uses of paracetamol', confidence: 1, entryId: 'AR-PARACETAMOL-USE' },
      },
      { ...message(2, 'Dissolution limits'), autoReply: { status: 'NOT_ELIGIBLE' } },
      message(3, 'Not yet looked at'),
    ],
  });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const pick = (name) => {
  fireEvent.mouseDown(tab(name), { button: 0 });
  fireEvent.click(tab(name));
};

describe('the mailbox buckets', () => {
  it('offers All Mails, Auto Reply and Human Intervention with their counts, All Mails first', async () => {
    renderInbox();
    await screen.findByText('Paracetamol');

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All Mails3', 'Auto Reply1', 'Human Intervention2']);
    expect(tab('All Mails')).toHaveAttribute('aria-selected', 'true');
    expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: undefined }));
  });

  it('keeps All Mails as it was: category cards, and accept and reject on every row', async () => {
    renderInbox();
    await screen.findByText('Paracetamol');

    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeInTheDocument();
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
    expect(rejectFor('MSG-00001')).toBeInTheDocument();
    expect(screen.getByText('Auto reply ready')).toHaveAttribute('title', 'Uses of paracetamol (100% match)');
  });

  it('lists the Auto Reply bucket without category cards, each mail with a link to review its reply', async () => {
    renderInbox();
    await screen.findByText('Paracetamol');

    pick('Auto Reply');

    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'auto_reply', offset: 0 })));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Filter by category' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Review the automatic reply to MSG-00001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept message MSG-00001' })).toBeNull();
  });

  it('lists Human Intervention with its category cards and the standard controls', async () => {
    renderInbox();
    await screen.findByText('Paracetamol');

    pick('Human Intervention');

    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'human', offset: 0 })));
    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeInTheDocument();
    expect(acceptFor('MSG-00002')).toBeInTheDocument();
  });

  it('shows no buckets for a mailbox that does not offer them', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Plain inbox')] });
    renderInbox();
    await screen.findByText('Plain inbox');

    expect(screen.queryByRole('tab')).toBeNull();
  });
});
