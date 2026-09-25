import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MailboxMessagePage } from '@/pages/frontOffice/MailboxMessagePage';
import { useAuthStore } from '@/store/useAuthStore';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { fetchMailboxMessage, markMailboxMessageRead } from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMailboxMessage: vi.fn(),
  markMailboxMessageRead: vi.fn(),
}));


const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

const MESSAGE = {
  mailboxMessageId: 'MSG-00001',
  from: 'Ravi Kumar <ravi@pharma.example>',
  to: 'ipc-mailbox@example.invalid',
  toAddresses: ['ipc-mailbox@example.invalid', 'registry@example.invalid'],
  cc: ['copy@pharma.example'],
  bcc: [],
  subject: 'Impurity limit for Paracetamol tablets',
  body: 'Please confirm the applicable impurity limit.\n\nRegards,\nRavi',
  bodyHtml: null,
  receivedAt: '2026-09-21T09:00:00.000Z',
  attachments: [],
  ingested: false,
  isRead: true,
  status: 'READ',
  linkedCase: null,
  createdAt: '2026-09-21T09:00:05.000Z',
};

function renderMessage(id = MESSAGE.mailboxMessageId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/front-officer/inbox/${id}`]}>
        <Routes>
          <Route path="/front-officer/inbox/:messageId" element={<MailboxMessagePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const field = (label) => screen.getByText(label, { selector: 'dt' }).parentElement;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMailboxMessage.mockResolvedValue(MESSAGE);
  markMailboxMessageRead.mockResolvedValue({ ...MESSAGE, isRead: true });
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('the message header', () => {
  it('shows the subject, focused, and every address the mail carried', async () => {
    renderMessage();

    const heading = await screen.findByRole('heading', { level: 1, name: MESSAGE.subject });
    expect(heading).toHaveFocus();
    expect(field('From')).toHaveTextContent('Ravi Kumar <ravi@pharma.example>');
    expect(field('To')).toHaveTextContent('ipc-mailbox@example.invalid, registry@example.invalid');
    expect(field('CC')).toHaveTextContent('copy@pharma.example');
    expect(screen.queryByText('BCC', { selector: 'dt' })).toBeNull();
    expect(field('Date').querySelector('time')).toHaveAttribute('datetime', MESSAGE.receivedAt);
    expect(screen.getByRole('link', { name: 'Back to IPC Mailbox' })).toHaveAttribute(
      'href',
      '/front-officer/inbox',
    );
  });
});

describe('the message body', () => {
  it('is plain text, with no frame and no Formatted choice when there is no HTML', async () => {
    renderMessage();

    expect(await screen.findByText(/Please confirm the applicable impurity limit/)).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Formatted' })).toBeNull();
  });

  it('renders HTML only inside a frame with no permissions and a no-fetch policy', async () => {
    fetchMailboxMessage.mockResolvedValue({
      ...MESSAGE,
      bodyHtml:
        '<meta http-equiv="refresh" content="0;url=https://evil.example/">' +
        '<p data-testid="mail-html-marker">Hello from the formatted body</p>' +
        '<script>window.__mailLeak = 1</script>' +
        '<img src="x" onerror="window.__mailLeak = 2">' +
        '<a href="https://site.example/">site</a>',
    });
    renderMessage();

    const formatted = await screen.findByRole('button', { name: 'Formatted' });
    expect(screen.getByRole('button', { name: 'Plain text' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('iframe')).toBeNull();

    fireEvent.click(formatted);

    const frame = screen.getByTitle('Formatted message body');
    expect(frame.getAttribute('sandbox')).toBe('');

    const srcdoc = frame.getAttribute('srcdoc');
    expect(srcdoc).not.toMatch(/<script/i);
    expect(srcdoc).not.toMatch(/refresh/i);

    const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe(CSP);
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    expect(doc.querySelector('meta[name="referrer"]').content).toBe('no-referrer');
    expect(doc.querySelector('[data-testid="mail-html-marker"]').textContent).toBe(
      'Hello from the formatted body',
    );
    expect(doc.querySelector('a').getAttribute('target')).toBe('_blank');

    expect(screen.queryByTestId('mail-html-marker')).toBeNull();
    expect(window.__mailLeak).toBeUndefined();
  });

  it('drops template content, and points SVG links at a new tab too', async () => {
    fetchMailboxMessage.mockResolvedValue({
      ...MESSAGE,
      bodyHtml:
        '<p>Hello</p><template shadowrootmode="open"><a href="https://evil.example/">x</a>' +
        '<meta http-equiv="refresh" content="0"></template>' +
        '<svg><a xlink:href="https://site.example/"><text>svg link</text></a></svg>',
    });
    renderMessage();

    fireEvent.click(await screen.findByRole('button', { name: 'Formatted' }));

    const srcdoc = screen.getByTitle('Formatted message body').getAttribute('srcdoc');
    expect(srcdoc).not.toMatch(/<template/i);
    expect(srcdoc).not.toMatch(/refresh/i);
    expect(srcdoc).not.toMatch(/evil\.example/);

    const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
    expect(doc.querySelector('svg a').getAttribute('target')).toBe('_blank');
  });
});

describe('attachments', () => {
  it('downloads through the message, and names a file that could not be saved', async () => {
    fetchMailboxMessage.mockResolvedValue({
      ...MESSAGE,
      attachments: [
        { attachmentId: 'att_1', filename: 'monograph.pdf', mimeType: 'application/pdf', size: 2048 },
        { attachmentId: null, filename: 'macro.xlsm', materializeError: 'unsupported file type' },
      ],
    });
    renderMessage();

    expect(await screen.findByRole('heading', { name: 'Attachments (2)' })).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toMatch(
      /\/mailbox\/messages\/MSG-00001\/attachments\/att_1\?download=1$/,
    );
    expect(screen.getByText('macro.xlsm')).toBeInTheDocument();
    expect(screen.getByText('Unavailable: unsupported file type')).toBeInTheDocument();
  });
});

describe('the query case', () => {
  it('links the case the message opened, with its statuses, and offers no decision', async () => {
    fetchMailboxMessage.mockResolvedValue({
      ...MESSAGE,
      status: 'ACCEPTED',
      ingested: true,
      linkedCase: { queryId: 'QRY-2026-00007', workflowState: 'PENDING_ASSIGNMENT', businessStatus: 'OPEN' },
    });
    renderMessage();

    expect(await screen.findByRole('link', { name: 'QRY-2026-00007' })).toHaveAttribute(
      'href',
      '/front-officer/queries/QRY-2026-00007',
    );
    expect(screen.getByText('PENDING ASSIGNMENT')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Accept|Reject|Delete) message/ })).toBeNull();
  });

  it.each([
    ['NEW', 'Awaiting validation'],
    ['REJECTED', 'Rejected'],
  ])('says what became of a %s message with no case', async (status, text) => {
    fetchMailboxMessage.mockResolvedValue({ ...MESSAGE, status });
    renderMessage();

    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe('read state', () => {
  it('marks an unread message read once, even when it is fetched again', async () => {
    fetchMailboxMessage.mockResolvedValue({ ...MESSAGE, isRead: false, status: 'NEW' });
    const queryClient = renderMessage();
    const key = ['mailbox', 'message', MESSAGE.mailboxMessageId];

    await waitFor(() => expect(queryClient.getQueryData(key).isRead).toBe(true));
    expect(markMailboxMessageRead).toHaveBeenCalledWith('MSG-00001');

    await act(() => queryClient.refetchQueries({ queryKey: key }));
    expect(fetchMailboxMessage).toHaveBeenCalledTimes(2);
    expect(markMailboxMessageRead).toHaveBeenCalledTimes(1);
  });

  it.each([true, null])('never marks a message whose isRead is %s', async (isRead) => {
    fetchMailboxMessage.mockResolvedValue({ ...MESSAGE, isRead });
    renderMessage();

    await screen.findByRole('heading', { level: 1 });
    expect(markMailboxMessageRead).not.toHaveBeenCalled();
  });
});

describe('a message that cannot be shown', () => {
  it('says it was not found, with a way back to the inbox', async () => {
    fetchMailboxMessage.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        response: { status: 404, data: { error: 'Message not found', messageId: 'MSG-09999' } },
      }),
    );
    renderMessage('MSG-09999');

    expect(await screen.findByText('Message not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to IPC Mailbox' })).toHaveAttribute(
      'href',
      '/front-officer/inbox',
    );
  });

  it('reports any other failure with the server reason', async () => {
    fetchMailboxMessage.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: 'MongoDB is not connected' } },
      }),
    );
    renderMessage();

    expect(await screen.findByRole('alert')).toHaveTextContent('MongoDB is not connected');
  });
});
