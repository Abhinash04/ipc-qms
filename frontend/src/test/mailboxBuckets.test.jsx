import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
import { notify } from '@/services/notify';
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

// The list only selects; a message's actions live in the detail pane, so each helper opens it first.
const mailList = () => within(screen.getByRole('list', { name: 'Mailbox messages' }));
const detail = () => within(screen.getByRole('region', { name: 'Message details' }));
const listed = (text) => mailList().getByText(text);
const findListed = async (text) => within(await screen.findByRole('list', { name: 'Mailbox messages' })).findByText(text);
const rowButton = (id) => screen.getByRole('list', { name: 'Mailbox messages' }).querySelector(`[data-message-id="${id}"]`);
const select = (id) => fireEvent.click(rowButton(id));
const opened = (action) => (id) => {
  select(id);
  return screen.getByRole('button', { name: `${action} message ${id}` });
};
const acceptFor = opened('Accept');
const rejectFor = opened('Reject');

function renderInbox() {
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
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
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
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
      {
        ...message(2, 'Dissolution limits'),
        autoReply: { status: 'NOT_ELIGIBLE', confidence: 0.87, threshold: 1, reason: 'closest supported question matched 87%, below 100%' },
      },
      { ...message(3, 'Not yet looked at'), source: 'nic-browser' },
    ],
  });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

const bucket = (name) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
const pick = (name) => fireEvent.click(bucket(name));

describe('the mailbox buckets', () => {
  it('offers All Mails, Auto Reply and Human Intervention with their counts, All Mails first', async () => {
    renderInbox();
    await findListed('Paracetamol');

    const views = screen.getByRole('group', { name: 'Mailbox views' });
    expect(within(views).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'All Mails, 3 messages',
      'Auto Reply, 1 message',
      'Human Intervention, 2 messages',
    ]);
    expect(bucket('All Mails')).toHaveAttribute('aria-pressed', 'true');
    expect(bucket('Auto Reply')).toHaveAttribute('aria-pressed', 'false');
    expect(bucket('Auto Reply')).toHaveAccessibleDescription('General queries with AI draft replies');
    expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: undefined }));
  });

  it('keeps All Mails as it was: category cards, and accept and reject on every row', async () => {
    renderInbox();
    await findListed('Paracetamol');

    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeInTheDocument();
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
    expect(rejectFor('MSG-00001')).toBeInTheDocument();
    expect(screen.queryByText('Auto reply ready')).toBeNull();
  });

  it('lists the Auto Reply bucket without category cards, each mail with Accept and Reject', async () => {
    renderInbox();
    await findListed('Paracetamol');

    pick('Auto Reply');

    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'auto_reply', offset: 0 })));
    expect(bucket('Auto Reply')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Filter by category' })).toBeNull());
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
    expect(rejectFor('MSG-00001')).toBeInTheDocument();
  });

  it('says accepting a mail offered a reply will answer it automatically, and confirms the reply was sent', async () => {
    const success = vi.spyOn(notify, 'success').mockImplementation(() => {});
    acceptMailboxMessage.mockResolvedValue({
      queryId: 'QRY-2026-00001',
      created: true,
      acknowledged: true,
      forwarded: false,
      aiSummaryStatus: 'GENERATED',
      autoReply: { sent: true },
      errors: [],
    });
    renderInbox();
    await findListed('Paracetamol');

    fireEvent.click(acceptFor('MSG-00001'));
    expect(screen.getByText('Register & auto-reply?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(success).toHaveBeenCalled());
    const [title, description] = success.mock.calls.at(-1);
    expect(title).toBe('Query case QRY-2026-00001 created');
    expect(description).toMatch(/AI summary generated · acknowledgement sent to ravi@pharma\.example · automatic reply sent to ravi@pharma\.example/);
    expect(description).not.toMatch(/Officer-in-Charge/);
  });

  it('asks to register and forward a mail left to a person', async () => {
    renderInbox();
    await findListed('Paracetamol');

    fireEvent.click(acceptFor('MSG-00002'));
    expect(screen.getByText('Register & forward?')).toBeInTheDocument();
  });

  it('lists Human Intervention with its category cards and the standard controls', async () => {
    renderInbox();
    await findListed('Paracetamol');

    pick('Human Intervention');

    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'human', offset: 0 })));
    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeInTheDocument();
    expect(acceptFor('MSG-00002')).toBeInTheDocument();
  });

  it('shows no buckets for a mailbox that does not offer them', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Plain inbox')] });
    renderInbox();
    await findListed('Plain inbox');

    expect(screen.queryByRole('group', { name: 'Mailbox views' })).toBeNull();
  });
});

describe('the confidence on every mail', () => {
  const rowOf = (subject) => listed(subject).closest('li');
  const REASON = 'Closest supported question matched 87%, below 100%';

  it('shows the score and the decision on each row, and in full on the open message', async () => {
    renderInbox();
    await findListed('Paracetamol');

    expect(rowOf('Paracetamol')).toHaveTextContent('AI 100% · Auto Reply');
    expect(rowOf('Dissolution limits')).toHaveTextContent('AI 87% · Human Intervention');
    expect(within(rowOf('Dissolution limits')).getByTitle(REASON)).toHaveTextContent('87% · Human Intervention');

    select('MSG-00002');
    expect(screen.getByRole('region', { name: 'Message details' })).toHaveTextContent('Confidence 87% · Human Intervention');
    expect(detail().getByTitle(REASON)).toHaveTextContent('87% · Human Intervention');
  });

  it('says when a mail has not been checked yet', async () => {
    renderInbox();
    await findListed('Paracetamol');

    expect(rowOf('Not yet looked at')).toHaveTextContent('AI not checked yet');
    select('MSG-00003');
    expect(screen.getByRole('region', { name: 'Message details' })).toHaveTextContent('Confidence Not checked yet');
  });

  it('shows no score for a mailbox the check does not cover', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Plain inbox')] });
    renderInbox();
    await findListed('Plain inbox');

    expect(screen.queryByText(/Confidence:/)).toBeNull();
    expect(screen.queryByText(/^AI /)).toBeNull();
  });
});
