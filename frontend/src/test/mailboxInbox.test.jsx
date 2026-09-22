import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
import { notify } from '@/services/notify';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import {
  fetchMailboxMessages,
  fetchMailboxDecisions,
  recordMailboxDecision,
  acceptMailboxMessage,
  deleteMailboxMessage,
  markMessageIngested,
  sendAcknowledgement,
  forwardQuery,
  syncMailbox,
} from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';

vi.mock('@/services/api/mailboxService', () => ({
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
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
}));

const FRONT_OFFICE = findUserById('USR-0002');

const ACK_RESULT = {
  from: 'Front Office <front-office@test.invalid>',
  to: ['someone@example.com'],
  subject: 'Acknowledgement',
  body: 'Received.',
  sentAt: '2026-08-18T09:05:00.000Z',
  providerMessageId: 'ack-1',
};

const message = (n, subject, from = 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>') => ({
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
  fetchMailboxMessages.mockResolvedValue({
    messages: [message(1, 'Keep this one'), message(2, 'Doomed enquiry')],
  });
  fetchMailboxDecisions.mockResolvedValue({ decisions: [] });
  recordMailboxDecision.mockResolvedValue({ alreadyDecided: false });
  // One call does the lot server-side, so this page's accept is a single
  // request whose answer it reports; the case comes back through GET /queries.
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

    // Listing the mailbox is not registering it. This is the whole point of the
    // change: arriving mail waits for a person.
    expect(useWorkflowStore.getState().queries).toHaveLength(0);
    expect(recordMailboxDecision).not.toHaveBeenCalled();
    expect(sendAcknowledgement).not.toHaveBeenCalled();
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
    // One click now covers both judgements, and the caption says so.
    expect(screen.getByText('Register & forward?')).toBeInTheDocument();
    // Still nothing sent on the first click.
    expect(acceptMailboxMessage).not.toHaveBeenCalled();

    fireEvent.click(confirm());

    // The client's whole half of the contract: one request, carrying the
    // message the server reads the sender off. Minting the Case ID, creating
    // the case and emailing ravi@pharma.example all happen in MongoDB.
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

    // That one request also records the ACCEPTED decision and sends the mail.
    // The browser orchestrates neither any more.
    expect(recordMailboxDecision).not.toHaveBeenCalled();
    expect(sendAcknowledgement).not.toHaveBeenCalled();

    // The row shows the case the server answered with, read back through
    // GET /queries rather than reconstructed here.
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

    // Accepting used to stop here, so forwarding could be a second judgement.
    // It never was one in practice — every accepted enquiry goes to the
    // Officer-in-Charge — and the gap was a case nobody had been told about, so
    // the accept endpoint forwards in the same request.
    expect(useWorkflowStore.getState().queries[0].workflowState).toBe(
      'PENDING_ASSIGNMENT',
    );
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
    // Still there — a rejection an administrator cannot inspect is barely
    // better than a deletion.
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
    // The undecided message still has both.
    expect(acceptFor('MSG-00001')).toBeInTheDocument();
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
      // Each row shows the case the server answered it with, so no row can end
      // up displaying another row's case.
      expect(await screen.findByText(caseId)).toBeInTheDocument();
    }

    // One request per message, each under its own mailbox id and carrying its
    // own From header. Reading the inquirer off that header, and giving each
    // enquiry a distinct Case ID, is the server's half.
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
    // The page re-reads the mailbox once the decision has settled.
    await waitFor(() => expect(fetchMailboxMessages).toHaveBeenCalledTimes(2));

    // A second accept can only come from a stale tab or a retry — drive the
    // store the same way the page would. The browser does not dedupe; the
    // server answers from the decision it already stored, which is what makes
    // one case, one acknowledgement and one forward guaranteed rather than
    // hoped for.
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
    // Nothing the browser could send twice: it sends no mail on this path.
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

/**
 * What the Front Officer is told when an acknowledgement may already be out.
 *
 * Accepting a NICeMail enquiry sends the acknowledgement through the signed-in
 * NICeMail browser. When Send is pressed and nothing confirms it left, the
 * server answers `acknowledged: false` with the error flagged `unconfirmed`.
 * This toast used to say "retry from the case page" for every failure — the one
 * piece of advice that, followed here, emails the inquirer twice.
 */
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

/**
 * The NICeMail mailbox is filled by an agent reading a signed-in browser tab.
 * A failed read does not fail the inbox request: the server answers 200 with
 * what it already has and reports the failure in `sync`. Nothing read that, so
 * a closed Chrome or an expired NICeMail session looked like an empty inbox.
 */
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

  // Every other mailbox's response has no `sync` field at all.
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

  // Awaiting is `unreadOnly`: not yet accepted or rejected, whether or not opened.
  it('narrows to mail awaiting validation', async () => {
    renderInbox();
    await screen.findByText('Keep this one');
    expect(fetchMailboxMessages).toHaveBeenLastCalledWith(expect.objectContaining({ unreadOnly: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Awaiting' }));

    expect(screen.getByRole('button', { name: 'Awaiting' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All mail' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(fetchMailboxMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ unreadOnly: true, offset: 0 }),
      ),
    );
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

    // Deleted, so page two is now past the end.
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
        // A mailbox that keeps no read state is not "unread".
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

    fireEvent.click(screen.getByText('Row body to click.'));
    expect(await screen.findByText('Opened MSG-00002')).toBeInTheDocument();
  });

  // Tooltip content is portaled out of the row, but React bubbles its clicks
  // up to the row all the same.
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

      // Back to the ordinary 15 s refresh.
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

  // The failed read keeps the last good answer, which still says `running`.
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
