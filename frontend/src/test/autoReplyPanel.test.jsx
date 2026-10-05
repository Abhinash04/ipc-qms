import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AutoReplyPanel } from '@/components/email/AutoReplyPanel';
import { approveAutoReply, declineAutoReply } from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService', () => ({
  approveAutoReply: vi.fn(),
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

const reply = () => screen.getByLabelText('Reply to ravi@pharma.example');

beforeEach(() => {
  vi.clearAllMocks();
  approveAutoReply.mockResolvedValue({ sent: true, queryId: 'QRY-2026-00090' });
  declineAutoReply.mockResolvedValue({ autoReply: { status: 'DECLINED' } });
});

describe('the automatic reply panel', () => {
  it('shows the matched question and the drafted reply, ready to edit', () => {
    renderPanel(mail());

    expect(screen.getByText(/Matched the supported question “What is the use case of paracetamol\?” \(100% match\)/)).toBeInTheDocument();
    expect(reply()).toHaveValue(DRAFT);
    expect(reply()).not.toHaveAttribute('readonly');
  });

  it('sends the Front Office’s edited text only after they confirm, naming the recipient', async () => {
    renderPanel(mail());
    fireEvent.change(reply(), { target: { value: 'Dear Sir/Madam,\n\nEdited answer.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(approveAutoReply).not.toHaveBeenCalled();
    expect(screen.getByText('Send this reply to ravi@pharma.example?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(approveAutoReply).toHaveBeenCalledWith('NIC-row-1', 'Dear Sir/Madam,\n\nEdited answer.'));
  });

  it('sends nothing when the confirmation is cancelled', () => {
    renderPanel(mail());
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(approveAutoReply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
  });

  it('cannot send an empty reply', () => {
    renderPanel(mail());
    fireEvent.change(reply(), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeDisabled();
  });

  it('sends the mail to Human Intervention instead', async () => {
    renderPanel(mail());
    fireEvent.click(screen.getByRole('button', { name: 'Send to Human Intervention' }));

    await waitFor(() => expect(declineAutoReply).toHaveBeenCalledWith('NIC-row-1'));
    expect(approveAutoReply).not.toHaveBeenCalled();
  });

  it('retries a failed send with the reply already approved, unchanged', async () => {
    renderPanel(
      mail({ status: 'FAILED', queryId: 'QRY-2026-00090', approvedBody: 'Approved text.', error: 'NICeMail refused the message' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The reply was not sent: NICeMail refused the message');
    expect(reply()).toHaveValue('Approved text.');
    expect(reply()).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Send to Human Intervention' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry sending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(approveAutoReply).toHaveBeenCalledWith('NIC-row-1', 'Approved text.'));
  });

  it('shows a sent reply as sent, with its closed case', () => {
    renderPanel(mail({ status: 'SENT', queryId: 'QRY-2026-00090', approvedBody: 'Approved text.', sentAt: '2026-10-05T05:00:00.000Z' }));

    expect(screen.getByText('Auto reply sent')).toBeInTheDocument();
    expect(screen.getByText('Approved text.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /QRY-2026-00090/ })).toHaveAttribute('href', '/front-officer/queries/QRY-2026-00090');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
  });

  it('shows nothing for a mail not offered a reply', () => {
    const { container } = renderPanel(mail({ status: 'NOT_ELIGIBLE' }));
    expect(container).toBeEmptyDOMElement();
  });
});
