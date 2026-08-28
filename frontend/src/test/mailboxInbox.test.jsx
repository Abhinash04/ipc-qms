import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import {
  fetchMailboxMessages,
  deleteMailboxMessage,
} from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn(),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
}));

const FRONT_OFFICE = findUserById('USR-0002');

const message = (n, subject) => ({
  mailboxMessageId: `MSG-0000${n}`,
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
  subject,
  body: 'Body text.',
  receivedAt: '2026-08-18T09:00:00.000Z',
  ingested: false,
});

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

const trashFor = (id) => screen.getByRole('button', { name: `Delete message ${id}` });

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMailboxMessages.mockResolvedValue({
    messages: [message(1, 'Keep this one'), message(2, 'Doomed enquiry')],
  });
  deleteMailboxMessage.mockResolvedValue({ deleted: true });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('the inbox lists real mailbox messages', () => {
  it('renders a row per message with a delete control', async () => {
    renderInbox();

    expect(await screen.findByText('Doomed enquiry')).toBeInTheDocument();
    expect(screen.getByText('Keep this one')).toBeInTheDocument();
    expect(trashFor('MSG-00001')).toBeInTheDocument();
    expect(trashFor('MSG-00002')).toBeInTheDocument();
  });
});

describe('deleting a message is a two-step confirm', () => {
  it('asks before deleting and sends nothing on the first click', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');

    fireEvent.click(trashFor('MSG-00002'));

    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(deleteMailboxMessage).not.toHaveBeenCalled();
  });

  it('cancelling puts the row back and still sends nothing', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');

    fireEvent.click(trashFor('MSG-00002'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));

    expect(screen.queryByText('Delete?')).toBeNull();
    expect(trashFor('MSG-00002')).toBeInTheDocument();
    expect(deleteMailboxMessage).not.toHaveBeenCalled();
  });

  it('confirming deletes that message and only that message', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');

    fireEvent.click(trashFor('MSG-00002'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(deleteMailboxMessage).toHaveBeenCalledWith('MSG-00002'));
    expect(deleteMailboxMessage).toHaveBeenCalledTimes(1);
  });

  it('drops the row once the server confirms', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');

    // What the refetch after a successful delete will return.
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Keep this one')] });

    fireEvent.click(trashFor('MSG-00002'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(screen.queryByText('Doomed enquiry')).toBeNull());
    expect(screen.getByText('Keep this one')).toBeInTheDocument();
  });

  it('reports a failure without pretending the message is gone', async () => {
    deleteMailboxMessage.mockRejectedValue(new Error('Network Error'));
    renderInbox();
    await screen.findByText('Doomed enquiry');

    fireEvent.click(trashFor('MSG-00002'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(await screen.findByText(/Could not delete that message/)).toBeInTheDocument();
    expect(screen.getByText('Doomed enquiry')).toBeInTheDocument();
  });
});

describe('a message that already opened a Query Case', () => {
  it('is still deletable, and the case survives', async () => {
    const source = message(1, 'Keep this one');
    const { queryId } = useWorkflowStore.getState().ingestEmail(source);
    fetchMailboxMessages.mockResolvedValue({ messages: [source] });

    renderInbox();
    await screen.findByText('Keep this one');

    // The row links to the case it created, and still offers delete.
    expect(screen.getByText(queryId)).toBeInTheDocument();
    fireEvent.click(trashFor('MSG-00001'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(deleteMailboxMessage).toHaveBeenCalledWith('MSG-00001'));

    // Deleting the mailbox copy leaves the Query Case untouched.
    expect(
      useWorkflowStore.getState().queries.some((q) => q.queryId === queryId),
    ).toBe(true);
  });
});
