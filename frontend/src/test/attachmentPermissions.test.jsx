import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';

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
  fetchAttachmentMeta: vi.fn().mockResolvedValue({}),
}));

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');

const s = () => useWorkflowStore.getState();

const NEW_STYLE = { attachmentId: 'att_1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 100 };
const LEGACY_STYLE = { id: 'legacy-1', name: 'old-scan.jpg', sizeKb: 40 };

const enquiry = (attachments) => ({
  mailboxMessageId: 'MSG-PERM-1',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Permissions check enquiry',
  body: 'Body',
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
  await s().hydrate();
  await s().resetDemo();
  ({ queryId } = s().ingestEmail(enquiry([NEW_STYLE, LEGACY_STYLE]), async () => null));
});

describe('attachment access follows the existing case permissions', () => {
  it('the inquirer who raised the case sees its attachments', async () => {
    renderAs(INQUIRER, `/inquirer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
  });

  it('a role with no route to this case is denied by the existing guard, not by attachment code', async () => {
    renderAs(INQUIRER, '/front-officer/queries');
    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
  });

  it.each([ROLES.REVIEWER, ROLES.ASSIGNED_OFFICIAL])(
    'denies the inquirer compose/queue URLs to %s the same as before this feature',
    async (role) => {
      renderAs(role, '/inquirer/compose');
      expect(await screen.findByText('Access restricted')).toBeInTheDocument();
    },
  );

  it('a legacy metadata-only attachment (no attachmentId) exposes no preview or download control', async () => {
    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);
    fireEvent.focus(await screen.findByRole('tab', { name: 'Attachments' }));

    const legacyRow = (await screen.findByText('old-scan.jpg')).closest('li');
    expect(within(legacyRow).queryByRole('button', { name: /Preview/ })).toBeNull();
    expect(within(legacyRow).queryByRole('link', { name: /Download/ })).toBeNull();
    expect(within(legacyRow).getByText('Preview unavailable')).toBeInTheDocument();

    // The real attachment in the same case is unaffected.
    const realRow = screen.getByText('spec.pdf').closest('li');
    expect(within(realRow).getByRole('button', { name: /Preview/ })).toBeInTheDocument();
  });
});
