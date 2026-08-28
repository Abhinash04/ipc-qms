import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLES } from '@/constants/roles';
import * as mailboxService from '@/services/api/mailboxService';
import * as attachmentService from '@/services/api/attachmentService';

vi.mock('@/services/api/mailboxService');
vi.mock('@/services/api/attachmentService');

const CONFIG = {
  transport: 'mock',
  ipcQueryEmail: 'configured-ipc@test.invalid',
  ipcReplyFrom: { email: 'arnd@test.invalid', name: 'AR&D Division' },
  inquirer: { email: 'configured-inquirer@test.invalid', name: 'Configured Inquirer' },
};

const COMPOSE = '/inquirer/compose';

function renderAt(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function signIn(role) {
  useAuthStore.setState({
    currentUser: { id: 'USR-TEST', name: 'Test User', role, email: 'test@ipc.example' },
  });
}

function file(name, type) {
  return new File(['bytes'], name, { type });
}

const input = () => document.getElementById('attachment-file-input');

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue(CONFIG);
  vi.mocked(mailboxService.sendEnquiry).mockResolvedValue({ providerMessageId: 'mock-msg-1' });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('composing an enquiry with attachments', () => {
  it('uploads pending files first, then sends both API calls with the returned records', async () => {
    const records = [{ attachmentId: 'att_1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 5 }];
    vi.mocked(attachmentService.uploadAttachments).mockResolvedValue(records);

    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'With attachment' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'See attached.' } });
    fireEvent.change(input(), { target: { files: [file('spec.pdf', 'application/pdf')] } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => {
      expect(attachmentService.uploadAttachments).toHaveBeenCalledTimes(1);
    });
    expect(mailboxService.sendEnquiry).toHaveBeenCalledWith({
      subject: 'With attachment',
      body: 'See attached.',
      attachments: records,
    });

    const raised = useWorkflowStore.getState().queries.find((q) => q.subject === 'With attachment');
    expect(raised.attachments).toEqual(records);
  });

  it('does not include an attachments key when nothing was attached (unchanged behaviour)', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'No attachment' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => {
      expect(mailboxService.sendEnquiry).toHaveBeenCalledWith({ subject: 'No attachment', body: 'Body' });
    });
    expect(attachmentService.uploadAttachments).not.toHaveBeenCalled();
  });

  it('blocks the send and reports the failure when the upload itself fails', async () => {
    vi.mocked(attachmentService.uploadAttachments).mockRejectedValue(new Error('Upload failed'));

    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Upload fails' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } });
    fireEvent.change(input(), { target: { files: [file('spec.pdf', 'application/pdf')] } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    expect(await screen.findByText(/Send failed: Upload failed/)).toBeInTheDocument();
    expect(mailboxService.sendEnquiry).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().queries.some((q) => q.subject === 'Upload fails')).toBe(false);
  });

  it('will not send while a pending file has failed pre-flight validation', async () => {
    signIn(ROLES.INQUIRER);
    renderAt(COMPOSE);

    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Bad file' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } });
    fireEvent.change(input(), { target: { files: [file('virus.exe', 'application/x-msdownload')] } });

    expect(screen.getByRole('button', { name: /Send enquiry/ })).toBeDisabled();
  });
});
