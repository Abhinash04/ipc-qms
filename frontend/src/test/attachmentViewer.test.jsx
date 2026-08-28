import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/api/attachmentService', () => ({
  attachmentUrl: (id, { download } = {}) => `http://backend.test/api/v1/attachments/${id}${download ? '?download=1' : ''}`,
  fetchAttachmentMeta: vi.fn(),
}));

import * as attachmentService from '@/services/api/attachmentService';

const INQUIRER = findUserById('USR-0001');
const s = () => useWorkflowStore.getState();

const ATTACHMENTS = [
  { attachmentId: 'att_pdf', filename: 'spec.pdf', mimeType: 'application/pdf', size: 2048 },
  { attachmentId: 'att_png', filename: 'photo.png', mimeType: 'image/png', size: 1024 },
  { attachmentId: 'att_xlsx', filename: 'sheet.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 4096 },
];

const enquiry = (attachments) => ({
  mailboxMessageId: 'MSG-ATT-1',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Enquiry with attachments',
  body: 'Please see attached.',
  attachments,
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

let queryId;

beforeEach(async () => {
  vi.mocked(attachmentService.fetchAttachmentMeta).mockResolvedValue({});
  await s().hydrate();
  await s().resetDemo();
  ({ queryId } = s().ingestEmail(enquiry(ATTACHMENTS), async () => null));
});

describe('the Attachments tab', () => {
  it('shows filename, type and size for every attachment', async () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('sheet.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('opens an image preview with the byte URL as the img src', async () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    const pngRow = (await screen.findByText('photo.png')).closest('li');
    fireEvent.click(within(pngRow).getByRole('button', { name: /Preview/ }));

    const img = await screen.findByRole('img', { name: 'photo.png' });
    expect(img).toHaveAttribute('src', 'http://backend.test/api/v1/attachments/att_png');
  });

  it('offers download-only for a file type with no in-app preview', async () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    const xlsxRow = (await screen.findByText('sheet.xlsx')).closest('li');
    fireEvent.click(within(xlsxRow).getByRole('button', { name: /Preview/ }));

    expect(await screen.findByText(/Preview not available for this file type/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download instead/ })).toHaveAttribute(
      'href',
      'http://backend.test/api/v1/attachments/att_xlsx?download=1',
    );
  });

  it('the row-level Download link always carries ?download=1', async () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    const pdfRow = (await screen.findByText('spec.pdf')).closest('li');
    expect(within(pdfRow).getByRole('link', { name: /Download/ })).toHaveAttribute(
      'href',
      'http://backend.test/api/v1/attachments/att_pdf?download=1',
    );
  });

  it('shows an unavailable state when the attachment no longer exists on the server', async () => {
    vi.mocked(attachmentService.fetchAttachmentMeta).mockRejectedValue(new Error('404'));

    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    const pdfRow = (await screen.findByText('spec.pdf')).closest('li');
    fireEvent.click(within(pdfRow).getByRole('button', { name: /Preview/ }));

    expect(await screen.findByText('This attachment is no longer available.')).toBeInTheDocument();
  });

  it('shows an empty state when the case has no attachments', async () => {
    const { queryId: emptyId } = s().ingestEmail(
      { ...enquiry([]), mailboxMessageId: 'MSG-ATT-2' },
      async () => null,
    );
    renderAs(INQUIRER, `/inquirer/queries/${emptyId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    expect(await screen.findByText('No attachments')).toBeInTheDocument();
  });
});
