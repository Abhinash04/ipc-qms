import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AutoReplyPanel } from '@/components/email/AutoReplyPanel';
import { declineAutoReply, retryAutoReply } from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService', () => ({
  retryAutoReply: vi.fn(),
  declineAutoReply: vi.fn(),
}));

const DRAFT = 'Dear Sir/Madam,\n\nParacetamol is a commonly used medicine.';

const mail = (autoReply) => ({
  mailboxMessageId: 'NIC-row-1',
  from: 'Ravi Kumar <ravi@pharma.example>',
  subject: 'Query',
  autoReply: {
    status: 'SUGGESTED',
    confidence: 1,
    entryId: 'AR-PARACETAMOL-USE',
    topic: 'Uses of paracetamol',
    question: 'What is the use case of paracetamol?',
    draft: DRAFT,
    ...autoReply,
  },
});

function renderPanel(message) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AutoReplyPanel message={message} caseHref={(queryId) => `/front-officer/queries/${queryId}`} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const reply = () => screen.getByRole('heading', { name: 'Reply to ravi@pharma.example' }).nextElementSibling;

beforeEach(() => {
  vi.clearAllMocks();
  retryAutoReply.mockResolvedValue({ sent: true, queryId: 'QRY-2026-00090' });
  declineAutoReply.mockResolvedValue({ autoReply: { status: 'DECLINED' } });
});

describe('the automatic reply panel', () => {
  it('shows the matched question and the reply that accepting the mail will send, read-only', () => {
    renderPanel(mail());

    expect(screen.getByText(/Matched the supported question “What is the use case of paracetamol\?” \(100% match\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sent automatically to ravi@pharma\.example when you accept this mail, after the acknowledgement/)).toBeInTheDocument();
    expect(reply()).toHaveTextContent('Paracetamol is a commonly used medicine.');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve|Send$|Retry/ })).toBeNull();
  });

  it('sends the mail to Human Intervention instead', async () => {
    renderPanel(mail());
    fireEvent.click(screen.getByRole('button', { name: 'Send to Human Intervention' }));

    await waitFor(() => expect(declineAutoReply).toHaveBeenCalledWith('NIC-row-1'));
  });

  it('retries a reply that could not be sent', async () => {
    renderPanel(mail({ status: 'FAILED', queryId: 'QRY-2026-00090', error: 'NICeMail refused the message' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The reply was not sent: NICeMail refused the message');
    expect(screen.queryByRole('button', { name: 'Send to Human Intervention' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry sending' }));
    await waitFor(() => expect(retryAutoReply).toHaveBeenCalledWith('NIC-row-1'));
  });

  it('shows a reply being sent, with nothing to press', () => {
    renderPanel(mail({ status: 'APPROVING', queryId: 'QRY-2026-00090' }));

    expect(screen.getByText('Sending to ravi@pharma.example…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a sent reply as sent, with its closed case', () => {
    renderPanel(mail({ status: 'SENT', queryId: 'QRY-2026-00090', sentAt: '2026-10-05T05:00:00.000Z' }));

    expect(screen.getByText('Auto reply sent')).toBeInTheDocument();
    expect(screen.getByText(/Sent to ravi@pharma\.example on .*The query case is closed\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /QRY-2026-00090/ })).toHaveAttribute('href', '/front-officer/queries/QRY-2026-00090');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows nothing for a mail not offered a reply', () => {
    const { container } = renderPanel(mail({ status: 'NOT_ELIGIBLE' }));
    expect(container).toBeEmptyDOMElement();
  });
});
