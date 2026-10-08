import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
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
  rescueMailboxMessage,
  setMailboxMessageCategory,
  sendAcknowledgement,
  forwardQuery,
  syncMailbox,
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

const message = (n, subject, from = 'Abhinash Pritiraj <abhinash.pritiraj@pharma.example>') => ({
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
const confirm = () => screen.getByRole('button', { name: 'Yes' });

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
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
  fetchMailboxMessages.mockResolvedValue({
    messages: [message(1, 'Keep this one'), message(2, 'Doomed enquiry')],
  });
  fetchMailboxDecisions.mockResolvedValue({ decisions: [] });
  recordMailboxDecision.mockResolvedValue({ alreadyDecided: false });
  acceptMailboxMessage.mockImplementation(fakeAcceptEndpoint());
  deleteMailboxMessage.mockResolvedValue({ deleted: true });
  markMessageIngested.mockResolvedValue({ ingested: true });
  sendAcknowledgement.mockResolvedValue(ACK_RESULT);
  forwardQuery.mockResolvedValue({ to: ['oic@test.invalid'], sentAt: '2026-08-18T09:10:00.000Z' });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('the inbox lists real mailbox messages', () => {
  it('lets the Super Admin read every message but accept, reject or delete none', async () => {
    useAuthStore.setState({ currentUser: { id: 'USR-0008', name: 'System Administrator', role: 'SUPER_ADMIN' } });
    renderInbox();

    expect(await screen.findByText('Doomed enquiry')).toBeInTheDocument();
    expect(screen.getByText('Keep this one')).toBeInTheDocument();
    expect(screen.getAllByText('View only')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^(Accept|Reject|Delete) message/ })).not.toBeInTheDocument();
  });

  it('renders a row per message with a delete control', async () => {
    renderInbox();

    expect(await screen.findByText('Doomed enquiry')).toBeInTheDocument();
    expect(screen.getByText('Keep this one')).toBeInTheDocument();
    expect(trashFor('MSG-00001')).toBeInTheDocument();
    expect(trashFor('MSG-00002')).toBeInTheDocument();
  });

  it('offers accept and reject on every undecided message, and registers none of them', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');

    expect(acceptFor('MSG-00001')).toBeInTheDocument();
    expect(rejectFor('MSG-00001')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting validation')).toHaveLength(2);

    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    expect(recordMailboxDecision).not.toHaveBeenCalled();
    expect(sendAcknowledgement).not.toHaveBeenCalled();
  });
});

describe('mail discarded on the server', () => {
  it('drops from the inbox at the next auto-refresh, without a reload', async () => {
    vi.useFakeTimers();
    try {
      renderInbox();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Doomed enquiry')).toBeInTheDocument();

      fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Keep this one')] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(2);
      for (let step = 0; step < 10; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }

      expect(screen.queryByText('Doomed enquiry')).toBeNull();
      expect(screen.getByText('Keep this one')).toBeInTheDocument();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('Scenario A — the Front Officer accepts a genuine enquiry', () => {
  it('hands the message to the accept endpoint and shows the case it answered with', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [message(1, 'Monograph query', 'Ravi Kumar <ravi@pharma.example>')],
    });
    renderInbox();
    await screen.findByText('Monograph query');

    fireEvent.click(acceptFor('MSG-00001'));
    expect(screen.getByText('Register & forward?')).toBeInTheDocument();
    expect(acceptMailboxMessage).not.toHaveBeenCalled();

    fireEvent.click(confirm());

    await waitFor(() =>
      expect(acceptMailboxMessage).toHaveBeenCalledWith(
        'MSG-00001',
        expect.objectContaining({
          mailboxMessageId: 'MSG-00001',
          from: 'Ravi Kumar <ravi@pharma.example>',
          subject: 'Monograph query',
          body: 'Body text.',
          receivedAt: '2026-08-18T09:00:00.000Z',
        }),
      ),
    );
    expect(acceptMailboxMessage).toHaveBeenCalledTimes(1);

    expect(recordMailboxDecision).not.toHaveBeenCalled();
    expect(sendAcknowledgement).not.toHaveBeenCalled();

    expect(await screen.findByText('QRY-2026-00001')).toBeInTheDocument();
    expect(useWorkflowStore.getState().queries.map((q) => q.queryId)).toEqual([
      'QRY-2026-00001',
    ]);
  });

  it('lands the case at pending assignment — accepting forwards it too', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    fireEvent.click(acceptFor('MSG-00001'));
    fireEvent.click(confirm());

    await waitFor(() => expect(useWorkflowStore.getState().queries).toHaveLength(1));

    expect(useWorkflowStore.getState().queries[0].workflowState).toBe(
      'PENDING_ASSIGNMENT',
    );
  });

  it('shows why the server refused to register the message', async () => {
    const reason = 'MSG-00001 was already rejected, so it cannot be registered.';
    acceptMailboxMessage.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { error: reason } },
      }),
    );
    const failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
    renderInbox();
    await screen.findByText('Keep this one');

    fireEvent.click(acceptFor('MSG-00001'));
    fireEvent.click(confirm());

    await waitFor(() => expect(failed).toHaveBeenCalledWith('Could not register that message', reason));
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    failed.mockRestore();
  });
});

describe('Scenario B — the Front Officer rejects an unwanted email', () => {
  it('creates no case, sends no acknowledgement, and records why', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [message(1, 'WIN A FREE HOLIDAY', 'Spam <spam@example.com>')],
    });
    renderInbox();
    await screen.findByText('WIN A FREE HOLIDAY');

    fireEvent.click(rejectFor('MSG-00001'));
    expect(screen.getByText('Reject?')).toBeInTheDocument();
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(recordMailboxDecision).toHaveBeenCalledWith(
        'MSG-00001',
        expect.objectContaining({ decision: 'REJECTED' }),
      ),
    );

    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    expect(sendAcknowledgement).not.toHaveBeenCalled();
  });

  it('shows the message as rejected, and keeps it listed rather than deleting it', async () => {
    fetchMailboxDecisions.mockResolvedValue({
      decisions: [{ mailboxMessageId: 'MSG-00002', decision: 'REJECTED', queryId: null }],
    });
    renderInbox();

    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Doomed enquiry')).toBeInTheDocument();
    expect(deleteMailboxMessage).not.toHaveBeenCalled();
  });

  it('offers no further decision once one has been taken', async () => {
    fetchMailboxDecisions.mockResolvedValue({
      decisions: [{ mailboxMessageId: 'MSG-00002', decision: 'REJECTED', queryId: null }],
    });
    renderInbox();
    await screen.findByText('Rejected');

    expect(screen.queryByRole('button', { name: 'Accept message MSG-00002' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject message MSG-00002' })).toBeNull();
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
  });
});

describe('a message someone else has already decided', () => {
  it('offers no accept or reject on rows the server lists as decided, and shows the rejection', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        {
          ...message(1, 'Keep this one'),
          status: 'ACCEPTED',
          linkedCase: { queryId: 'QRY-2026-00007', workflowState: 'PENDING_ASSIGNMENT', businessStatus: 'OPEN' },
        },
        { ...message(2, 'Doomed enquiry'), status: 'REJECTED' },
        message(3, 'Still waiting'),
      ],
    });
    renderInbox();
    await screen.findByText('Still waiting');

    for (const id of ['MSG-00001', 'MSG-00002']) {
      expect(screen.queryByRole('button', { name: `Accept message ${id}` })).toBeNull();
      expect(screen.queryByRole('button', { name: `Reject message ${id}` })).toBeNull();
    }
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(acceptFor('MSG-00003')).toBeInTheDocument();
    expect(rejectFor('MSG-00003')).toBeInTheDocument();
  });

  it('takes the controls away once a refetch shows the message was decided', async () => {
    renderInbox();
    await screen.findByText('Doomed enquiry');
    expect(acceptFor('MSG-00002')).toBeInTheDocument();

    fetchMailboxMessages.mockResolvedValue({
      messages: [message(1, 'Keep this one'), { ...message(2, 'Doomed enquiry'), status: 'REJECTED' }],
    });
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Accept message MSG-00002' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Reject message MSG-00002' })).toBeNull();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
  });

  it('says who got there first when a reject finds the message already decided', async () => {
    recordMailboxDecision.mockResolvedValueOnce({
      alreadyDecided: true,
      decision: { mailboxMessageId: 'MSG-00001', decision: 'ACCEPTED', queryId: 'QRY-2026-00009' },
    });
    const warning = vi.spyOn(notify, 'warning').mockImplementation(() => {});
    const info = vi.spyOn(notify, 'info').mockImplementation(() => {});
    renderInbox();
    await screen.findByText('Keep this one');

    fireEvent.click(rejectFor('MSG-00001'));
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'Already decided by someone else',
        expect.stringMatching(/accepted as QRY-2026-00009/),
      ),
    );
    expect(info).not.toHaveBeenCalledWith('Message rejected', expect.anything());
    expect(markMessageIngested).not.toHaveBeenCalled();
    warning.mockRestore();
    info.mockRestore();
  });
});

describe('Scenario C — many inquirers, one mailbox', () => {
  it('accepts each message on its own and shows every row its own case', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        message(1, 'First query', 'inquirer1@example.com'),
        message(2, 'Second query', 'Second Person <inquirer2@example.org>'),
        message(3, 'Third query', 'inquirer3@example.net'),
      ],
    });
    renderInbox();
    await screen.findByText('Third query');

    for (const [id, caseId] of [
      ['MSG-00001', 'QRY-2026-00001'],
      ['MSG-00002', 'QRY-2026-00002'],
      ['MSG-00003', 'QRY-2026-00003'],
    ]) {
      fireEvent.click(acceptFor(id));
      fireEvent.click(confirm());
      expect(await screen.findByText(caseId)).toBeInTheDocument();
    }

    expect(acceptMailboxMessage.mock.calls.map(([id, sent]) => [id, sent.from])).toEqual([
      ['MSG-00001', 'inquirer1@example.com'],
      ['MSG-00002', 'Second Person <inquirer2@example.org>'],
      ['MSG-00003', 'inquirer3@example.net'],
    ]);
    expect(useWorkflowStore.getState().queries).toHaveLength(3);
  });
});

describe('Scenario D — the same message accepted twice', () => {
  it('is answered from the stored decision, and nothing is created a second time', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Only once')] });
    renderInbox();
    await screen.findByText('Only once');

    fireEvent.click(acceptFor('MSG-00001'));
    fireEvent.click(confirm());
    expect(await screen.findByText('QRY-2026-00001')).toBeInTheDocument();
    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenCalledTimes(2));

    const [first] = useWorkflowStore.getState().queries;
    let again;
    await act(async () => {
      again = await useWorkflowStore
        .getState()
        .acceptMailboxMessage(message(1, 'Only once'));
    });

    expect(again).toMatchObject({
      queryId: first.queryId,
      created: false,
      alreadyDecided: true,
      accepted: false,
    });
    expect(acceptMailboxMessage).toHaveBeenCalledTimes(2);
    expect(useWorkflowStore.getState().queries).toHaveLength(1);
    expect(sendAcknowledgement).not.toHaveBeenCalled();
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

    expect(screen.getByText(queryId)).toBeInTheDocument();
    fireEvent.click(trashFor('MSG-00001'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(deleteMailboxMessage).toHaveBeenCalledWith('MSG-00001'));

    expect(
      useWorkflowStore.getState().queries.some((q) => q.queryId === queryId),
    ).toBe(true);
  });
});

describe('an acknowledgement that may already have been sent', () => {
  const answer = (ackError) => ({
    queryId: 'QRY-2026-00001',
    created: true,
    alreadyDecided: false,
    acknowledged: false,
    forwarded: true,
    aiSummaryStatus: 'FALLBACK',
    errors: [{ step: 'acknowledgement', ...ackError }],
  });

  async function acceptAndReadToast() {
    const success = vi.spyOn(notify, 'success');
    renderInbox();
    await screen.findByText('Keep this one');

    fireEvent.click(acceptFor('MSG-00001'));
    fireEvent.click(confirm());

    await waitFor(() => expect(success).toHaveBeenCalled());
    const [, description] = success.mock.calls.at(-1);
    success.mockRestore();
    return description;
  }

  it('says to check the Sent folder, and does not advise a retry', async () => {
    acceptMailboxMessage.mockResolvedValueOnce(
      answer({ error: 'NICeMail may have sent this message but did not confirm it in time.', unconfirmed: true }),
    );

    const description = await acceptAndReadToast();

    expect(description).toMatch(/may already have been sent/);
    expect(description).toMatch(/check the NICeMail Sent folder before retrying/);
    expect(description).not.toMatch(/retry from the case page/);
  });

  it('still advises a retry when the acknowledgement plainly did not go', async () => {
    acceptMailboxMessage.mockResolvedValueOnce(answer({ error: 'SMTP refused the acknowledgement' }));

    const description = await acceptAndReadToast();

    expect(description).toMatch(/acknowledgement not sent/);
    expect(description).toMatch(/retry from the case page/);
  });
});

describe('a NICeMail mailbox that could not be read', () => {
  const failedSync = {
    ok: false,
    at: '2026-09-18T12:00:00.000Z',
    stored: 0,
    stage: 'connect_browser',
    error: 'Chrome is not available for browser automation.',
    running: false,
  };

  it('says so, with the reason, instead of looking like an empty inbox', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [], sync: failedSync });

    renderInbox();

    const notice = await screen.findByText(/The mailbox could not be read/);
    expect(notice.closest('[role="alert"]')).toHaveTextContent('Chrome is not available');
    expect(notice.closest('[role="alert"]')).toHaveTextContent('connect_browser');
  });

  it('shows nothing when the sync worked', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [], sync: { ...failedSync, ok: true, error: null } });

    renderInbox();
    await screen.findByText(/No Mail in the IPC Mailbox/);

    expect(screen.queryByText(/The mailbox could not be read/)).toBeNull();
  });

  it('never appears for a mailbox that is not NICeMail', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    expect(screen.queryByText(/The mailbox could not be read/)).toBeNull();
  });
});

describe('finding mail', () => {
  const searchBox = () => screen.getByRole('searchbox', { name: 'Search mail' });

  it('shows that the mailbox is loading, not that it is empty', async () => {
    let answer;
    fetchMailboxMessages.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderInbox();

    expect(screen.getByRole('status', { name: 'Loading mail' })).toBeInTheDocument();
    expect(screen.queryByText('No Mail in the IPC Mailbox')).toBeNull();

    await act(async () => answer({ messages: [] }));
    expect(await screen.findByText('No Mail in the IPC Mailbox')).toBeInTheDocument();
  });

  it('searches on the server once typing pauses, not on every keystroke', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    fireEvent.change(searchBox(), { target: { value: 'mono' } });
    fireEvent.change(searchBox(), { target: { value: 'monograph' } });

    await waitFor(() =>
      expect(fetchMailboxMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'monograph', limit: 50, offset: 0 }),
      ),
    );
    expect(fetchMailboxMessages.mock.calls.map(([args]) => args.q)).not.toContain('mono');
  });

  it('says nothing matches, rather than that the mailbox is empty', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    fetchMailboxMessages.mockResolvedValue({ messages: [], total: 0, limit: 50, offset: 0 });
    fireEvent.change(searchBox(), { target: { value: 'nothing like this' } });

    expect(await screen.findByText('No messages match')).toBeInTheDocument();
    expect(screen.queryByText('No Mail in the IPC Mailbox')).toBeNull();
  });

  it('shows every message, with no All mail / Awaiting / Junk filter', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ unreadOnly: false }));
    expect(fetchMailboxMessages.mock.calls.at(-1)[0]).not.toHaveProperty('junkOnly');
    for (const name of ['All mail', 'Awaiting', 'Junk']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('pages through the list 50 at a time', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        message(1, 'First of many', 'First Sender <first@pharma.example>'),
        message(2, 'Second of many', 'Second Sender <second@pharma.example>'),
      ],
      total: 120,
      limit: 50,
      offset: 0,
    });
    renderInbox();

    const pages = await screen.findByRole('navigation', { name: 'Mailbox pages' });
    expect(pages).toHaveTextContent('Showing 1–2 of 120');
    expect(screen.getByText('120 Messages Total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(fetchMailboxMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 50, offset: 50 }),
      ),
    );
    await waitFor(() => expect(pages).toHaveTextContent('Showing 51–52 of 120'));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('steps back a page when the last row on this one goes', async () => {
    const page = (total, rows) => ({ messages: rows, total, limit: 50 });
    fetchMailboxMessages.mockImplementation(async ({ offset }) =>
      offset === 0
        ? page(51, [message(1, 'First page mail')])
        : page(51, [message(2, 'Only mail on page two')]),
    );
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByText('Only mail on page two');

    fetchMailboxMessages.mockImplementation(async ({ offset }) =>
      offset === 0 ? page(50, [message(1, 'First page mail')]) : page(50, []),
    );
    fireEvent.click(trashFor('MSG-00002'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(await screen.findByText('First page mail')).toBeInTheDocument();
    expect(screen.queryByText('No Mail in the IPC Mailbox')).toBeNull();
    expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
  });
});

describe('what each row shows', () => {
  it('marks only mail not yet opened here, and shows the start of each body', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        { ...message(1, 'Opened already', 'Read Sender <read@pharma.example>'), isRead: true },
        {
          ...message(2, 'Not yet opened', 'Ravi Kumar <ravi@pharma.example>'),
          isRead: false,
          body: 'Please confirm the\n\n   impurity limit.',
        },
        { ...message(3, 'No read state', 'Other Sender <other@pharma.example>'), isRead: null },
      ],
    });
    renderInbox();
    await screen.findByText('Not yet opened');

    expect(screen.getAllByText('Unread')).toHaveLength(1);
    expect(screen.getByText('Unread').parentElement).toHaveTextContent('Ravi Kumar');
    expect(screen.getByText('Please confirm the impurity limit.')).toBeInTheDocument();
  });

  it('links the case the server reports, even one this tab has never loaded', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        {
          ...message(1, 'Already accepted', 'Ravi Kumar <ravi@pharma.example>'),
          ingested: true,
          status: 'ACCEPTED',
          linkedCase: { queryId: 'QRY-2026-00042', workflowState: 'PENDING_ASSIGNMENT', businessStatus: 'OPEN' },
        },
      ],
    });
    renderInbox();

    expect(await screen.findByRole('link', { name: 'QRY-2026-00042' })).toHaveAttribute(
      'href',
      '/front-officer/queries/QRY-2026-00042',
    );
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
  });
});

describe('opening a message', () => {
  function Opened() {
    const { messageId } = useParams();
    return <p>Opened {messageId}</p>;
  }

  function renderInboxRoutes() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/front-officer/inbox']}>
          <Routes>
            <Route path="/front-officer/inbox" element={<MailboxInboxPage />} />
            <Route path="/front-officer/inbox/:messageId" element={<Opened />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('opens from the subject, which is a real link', async () => {
    renderInboxRoutes();

    const subject = await screen.findByRole('link', { name: 'Doomed enquiry' });
    expect(subject).toHaveAttribute('href', '/front-officer/inbox/MSG-00002');

    fireEvent.click(subject);
    expect(await screen.findByText('Opened MSG-00002')).toBeInTheDocument();
  });

  it('opens from anywhere else on the row, but not from a control on it', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [
        { ...message(2, 'Doomed enquiry', 'Ravi Kumar <ravi@pharma.example>'), body: 'Row body to click.' },
      ],
    });
    renderInboxRoutes();
    await screen.findByText('Doomed enquiry');

    fireEvent.click(trashFor('MSG-00002'));
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(screen.queryByText(/^Opened/)).toBeNull();

    // jsdom has no layout to hit-test, so check the mechanism instead: the subject link is
    // stretched over the whole row by its ::after, and the row's controls sit above it.
    const subject = screen.getByRole('link', { name: 'Doomed enquiry' });
    expect(subject).toHaveClass('after:absolute', 'after:inset-0');
    expect(trashFor('MSG-00002').closest('.relative.z-10')).not.toBeNull();
    expect(screen.getByText('Row body to click.').closest('.relative.z-10')).toBeNull();
  });

  it('does not open from a click on a tooltip', async () => {
    renderInboxRoutes();
    await screen.findByText('Doomed enquiry');

    act(() => rejectFor('MSG-00002').focus());
    fireEvent.click(await screen.findByRole('tooltip'));

    expect(screen.queryByText(/^Opened/)).toBeNull();
  });
});

describe('Sync now', () => {
  const nicInbox = (running) => ({
    backend: 'nic-browser',
    messages: [message(1, 'Keep this one', 'Ravi Kumar <ravi@pharma.example>')],
    sync: { ok: true, at: '2026-09-21T09:00:00.000Z', stored: 0, stage: null, error: null, running },
  });

  it('is offered only for the NICeMail mailbox', async () => {
    renderInbox();
    await screen.findByText('Keep this one');

    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });

  it('is not offered by a backend that only views NICeMail, which says the host reads it', async () => {
    fetchMailboxMessages.mockResolvedValue({
      ...nicInbox(false),
      sync: { ...nicInbox(false).sync, ok: null, viewer: true },
    });
    renderInbox();
    await screen.findByText('Keep this one');

    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.getByText(/read by the mailbox host/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('starts one NICeMail sync and says so', async () => {
    const info = vi.spyOn(notify, 'info').mockImplementation(() => {});
    fetchMailboxMessages.mockResolvedValue(nicInbox(false));
    syncMailbox.mockResolvedValue({ supported: true, started: true, sync: nicInbox(true).sync });
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await waitFor(() =>
      expect(info).toHaveBeenCalledWith('NICeMail sync started', expect.any(String), { id: 'mailbox-sync' }),
    );
    expect(syncMailbox).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it('polls every 3 s while a sync runs, and stops when it ends', async () => {
    vi.useFakeTimers();
    try {
      fetchMailboxMessages.mockResolvedValue(nicInbox(true));
      renderInbox();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(2);

      fetchMailboxMessages.mockResolvedValue(nicInbox(false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops polling every 3 s once the list cannot be read', async () => {
    vi.useFakeTimers();
    try {
      fetchMailboxMessages.mockResolvedValue(nicInbox(true));
      renderInbox();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      fetchMailboxMessages.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 503'), {
          response: { status: 503, data: { error: 'The mailbox is unreachable' } },
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(fetchMailboxMessages).toHaveBeenCalledTimes(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('junk mail in the feed', () => {
  const hoursFromNow = (n) => new Date(Date.now() + n * 3600000).toISOString();

  const junkMessage = (n, subject, over = {}) => ({
    ...message(n, subject, 'Blast <news@marketing.invalid>'),
    triage: {
      verdict: 'JUNK',
      confidence: 1,
      reason: 'one-click unsubscribe',
      classifier: 'rules',
      rule: 'bulk',
      classifiedAt: '2026-08-18T09:00:00.000Z',
      rescuedAt: null,
      purgesAt: hoursFromNow(12),
      ...over,
    },
  });

  it('warns how long is left before the content is destroyed', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [junkMessage(9, 'Half price reagents')] });
    renderInbox();

    expect(await screen.findByText('Removed from app in 12h')).toBeInTheDocument();
  });

  it('counts a long window in days rather than a three-figure number of hours', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [junkMessage(9, 'Half price reagents', { purgesAt: hoursFromNow(336) })],
    });
    renderInbox();

    expect(await screen.findByText('Removed from app in 14d')).toBeInTheDocument();
  });

  it('shows no countdown on a genuine message, which is never purged by age', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [junkMessage(9, 'Unactioned enquiry', { verdict: 'GENUINE', confidence: 0, purgesAt: null })],
    });
    renderInbox();
    await screen.findByText('Unactioned enquiry');

    expect(screen.queryByText(/Removed from app/)).not.toBeInTheDocument();
  });

  it('says nothing about purging for a message with no verdict at all', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Ordinary enquiry')] });
    renderInbox();
    await screen.findByText('Ordinary enquiry');

    expect(screen.queryByText(/Removed from app/)).not.toBeInTheDocument();
  });

  it('offers Rescue on a junk row and clears the verdict without opening a case', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [junkMessage(9, 'Half price reagents')] });
    renderInbox();
    await screen.findByText('Half price reagents');

    fireEvent.click(screen.getByRole('button', { name: 'Rescue message MSG-00009' }));

    await waitFor(() => expect(rescueMailboxMessage).toHaveBeenCalledWith('MSG-00009'));
    expect(acceptMailboxMessage).not.toHaveBeenCalled();
    expect(sendAcknowledgement).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
  });

  it('offers no Rescue on a message that was never judged junk', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [message(1, 'Ordinary enquiry')] });
    renderInbox();
    await screen.findByText('Ordinary enquiry');

    expect(screen.queryByRole('button', { name: /Rescue message/ })).not.toBeInTheDocument();
  });

  it('offers no Rescue once the verdict has already been cleared', async () => {
    fetchMailboxMessages.mockResolvedValue({
      messages: [junkMessage(9, 'Half price reagents', { rescuedAt: '2026-08-19T09:00:00.000Z', purgesAt: null })],
    });
    renderInbox();
    await screen.findByText('Half price reagents');

    expect(screen.queryByRole('button', { name: /Rescue message/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Removed from app/)).not.toBeInTheDocument();
  });

  it('tells the Front Officer when a rescue could not be recorded', async () => {
    fetchMailboxMessages.mockResolvedValue({ messages: [junkMessage(9, 'Half price reagents')] });
    rescueMailboxMessage.mockRejectedValueOnce({ response: { data: { error: 'Mailbox unavailable' } } });
    const failed = vi.spyOn(notify, 'error');
    renderInbox();
    await screen.findByText('Half price reagents');

    fireEvent.click(screen.getByRole('button', { name: 'Rescue message MSG-00009' }));

    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(failed.mock.calls[0][1].description).toMatch(/Mailbox unavailable/);
  });
});

describe('email categories in the feed', () => {
  const COUNTS = {
    OFFICIAL_QUERY: 4,
    EVENT_INVITATION: 2,
    SYSTEM_NOTIFICATION: 1,
    ADVERTISEMENT: 3,
    DUPLICATE: 1,
    OTHER: 0,
    UNCLASSIFIED: 1,
    REGISTERED: 2,
  };

  const triaged = (n, subject, triage) => ({ ...message(n, subject), triage: { verdict: 'GENUINE', ...triage } });

  beforeEach(() => {
    fetchMailboxMessages.mockResolvedValue({
      backend: 'nic-browser',
      categoryCounts: COUNTS,
      messages: [
        triaged(1, 'Assay of metformin', {
          category: 'OFFICIAL_QUERY',
          categoryConfidence: 0.91,
          categoryReason: 'asks about an IP assay',
          categorySource: 'gemma',
          predictedCategory: 'OFFICIAL_QUERY',
          predictedConfidence: 0.91,
          needsReview: false,
          related: [{ kind: 'FOLLOW_UP', queryId: 'QRY-2026-00012', mailboxMessageId: null, score: null }],
        }),
        triaged(2, 'Hello there', {
          category: 'OTHER',
          categoryConfidence: 0.4,
          categorySource: 'gemma',
          predictedCategory: 'EVENT_INVITATION',
          predictedConfidence: 0.4,
          needsReview: true,
          related: [],
        }),
        message(3, 'Not yet looked at'),
      ],
    });
  });

  it('shows a category badge on every row, and says when one is not classified yet', async () => {
    renderInbox();
    await screen.findByText('Assay of metformin');

    expect(screen.getByRole('button', { name: 'Category: Official Queries. Show details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Category: Other / Unclassified, needs review. Show details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Category: Not classified yet. Show details' })).toBeInTheDocument();
  });

  it('offers a card per category with its count, and filters the feed by it', async () => {
    renderInbox();
    await screen.findByText('Assay of metformin');

    const cards = screen.getByRole('group', { name: 'Filter by category' });
    expect(within(cards).getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'All, 14 messages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Events, 2 messages' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Events, 2 messages' }));

    await waitFor(() =>
      expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'EVENT_INVITATION', offset: 0 })),
    );
    expect(screen.getByRole('button', { name: 'Events, 2 messages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All, 14 messages' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'All, 14 messages' }));
    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ category: undefined })));
  });

  it('offers Registered queries as its own bucket', async () => {
    renderInbox();
    await screen.findByText('Assay of metformin');

    const registered = screen.getByRole('button', { name: 'Registered queries, 2 messages' });
    expect(registered).toHaveAccessibleDescription('Accepted, with a Query ID');
    fireEvent.click(registered);

    await waitFor(() =>
      expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'REGISTERED', offset: 0 })),
    );
  });

  it('describes each category card', async () => {
    renderInbox();
    await screen.findByText('Assay of metformin');

    expect(screen.getByRole('button', { name: 'Official queries, 4 messages' })).toHaveAccessibleDescription(
      'Queries, RTIs and official notices',
    );
    expect(screen.getByRole('button', { name: 'Other, 0 messages' })).toHaveAccessibleDescription('Fits no other category');
    expect(screen.getByRole('button', { name: 'System, 1 message' })).toBeInTheDocument();
  });

  it('says how many messages are still being classified, and only when there are some', async () => {
    renderInbox();
    await screen.findByText('Assay of metformin');
    expect(screen.getByText('1 being classified')).toBeInTheDocument();

    fetchMailboxMessages.mockResolvedValue({
      backend: 'nic-browser',
      categoryCounts: { ...COUNTS, UNCLASSIFIED: 0 },
      messages: [message(1, 'All sorted')],
    });
    cleanup();
    renderInbox();
    await screen.findByText('All sorted');
    expect(screen.queryByText(/being classified/)).toBeNull();
  });

  it('hides the category cards for a mailbox that is not categorised', async () => {
    fetchMailboxMessages.mockResolvedValue({ backend: 'mongo', messages: [message(1, 'Plain one')] });
    renderInbox();
    await screen.findByText('Plain one');

    expect(screen.queryByRole('group', { name: 'Filter by category' })).toBeNull();
  });

  it('shows the AI prediction, its confidence, its reason and the linked case', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Category: Official Queries. Show details' }));

    expect(await screen.findByText('Confidence 91% · AI (Gemma)')).toBeInTheDocument();
    expect(screen.getByText('“asks about an IP assay”')).toBeInTheDocument();
    expect(screen.getByText(/Follow-up on/)).toHaveTextContent('Follow-up on QRY-2026-00012');
  });

  it('shows what the AI suggested when it was unsure', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /Other \/ Unclassified, needs review/ }));

    expect(await screen.findByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('AI suggested Events and Invitations (40%)')).toBeInTheDocument();
  });

  it('lets the Front Officer correct a category without accepting, rejecting or opening the message', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: /Other \/ Unclassified, needs review/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Events and Invitations' }));

    await waitFor(() => expect(setMailboxMessageCategory).toHaveBeenCalledWith('MSG-00002', 'EVENT_INVITATION'));
    expect(recordMailboxDecision).not.toHaveBeenCalled();
    expect(acceptMailboxMessage).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    await waitFor(() => expect(fetchMailboxMessages.mock.calls.length).toBeGreaterThan(1));
  });

  it('does not offer the category it is already in', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Category: Official Queries. Show details' }));

    await screen.findByRole('button', { name: 'Move to Events and Invitations' });
    expect(screen.queryByRole('button', { name: 'Move to Official Queries' })).toBeNull();
  });
});
