import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api/userAdminService', () => ({
  fetchAccounts: vi.fn(),
  approveAccount: vi.fn(),
  rejectAccount: vi.fn(),
  deactivateAccount: vi.fn(),
  reactivateAccount: vi.fn(),
  changeAccountRole: vi.fn(),
}));
vi.mock('@/services/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { notify } from '@/services/notify';
import {
  fetchAccounts,
  approveAccount,
  rejectAccount,
  deactivateAccount,
} from '@/services/api/userAdminService';

const ADMIN = findUserById('USR-0007');
const SUPER_ADMIN = findUserById('USR-0008');

const account = (overrides) => ({
  department: 'Quality Assurance & Standards',
  requestedDesignation: 'Front Officer',
  role: null,
  status: 'PENDING',
  source: 'registered',
  createdAt: '2026-10-08T09:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  deactivatedAt: null,
  lastLoginAt: null,
  ...overrides,
});

const ACCOUNTS = [
  account({ id: 'USR-p1', name: 'Priya Pending', email: 'priya@ipc.example' }),
  account({ id: 'USR-p2', name: 'Rohan Request', email: 'rohan@ipc.example', requestedDesignation: 'Reviewer' }),
  account({ id: 'USR-a1', name: 'Asha Approved', email: 'asha@ipc.example', status: 'APPROVED', role: 'REVIEWER' }),
  account({ id: 'USR-r1', name: 'Ravi Rejected', email: 'ravi@ipc.example', status: 'REJECTED', rejectionReason: 'Not an IPC employee.' }),
  account({ id: 'USR-0004', name: 'Neha Singh', email: 'neha.singh@ipc.example', status: 'APPROVED', role: 'ASSIGNED_OFFICIAL', source: 'built-in', requestedDesignation: '' }),
];
const COUNTS = { PENDING: 2, APPROVED: 2, REJECTED: 1, DEACTIVATED: 0 };

function renderPage(viewer = ADMIN, accounts = ACCOUNTS) {
  useAuthStore.setState({ currentUser: viewer, authReady: true });
  vi.mocked(fetchAccounts).mockResolvedValue({ accounts, counts: COUNTS });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const review = async (name) => {
  fireEvent.click(await screen.findByRole('button', { name: `Review ${name}` }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the Users page', () => {
  it('shows the counts per status and lists pending requests first', async () => {
    renderPage();

    expect(await screen.findByText('Priya Pending')).toBeInTheDocument();
    const tiles = within(screen.getByRole('group', { name: 'Account status' }));
    const valueOf = (label) =>
      tiles.getByRole('button', { name: new RegExp(label) }).querySelector('[data-slot="stat-value"]').textContent;
    expect(valueOf('Pending requests')).toBe('2');
    expect(valueOf('Approved users')).toBe('2');
    expect(valueOf('Rejected requests')).toBe('1');
    expect(valueOf('Deactivated users')).toBe('0');
    expect(tiles.getByRole('button', { name: /Pending requests/ })).toHaveAttribute('aria-pressed', 'true');

    expect(screen.getByText('Rohan Request')).toBeInTheDocument();
    expect(screen.queryByText('Asha Approved')).toBeNull();
  });

  it('switches status with the tiles and narrows with search', async () => {
    renderPage();
    await screen.findByText('Priya Pending');

    fireEvent.click(screen.getByRole('button', { name: /Approved users/ }));
    expect(screen.getByText('Asha Approved')).toBeInTheDocument();
    expect(screen.getByText('Neha Singh')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'asha' } });
    expect(screen.getByText('Asha Approved')).toBeInTheDocument();
    expect(screen.queryByText('Neha Singh')).toBeNull();
  });

  it('approves only once a role is chosen, sends that role, and confirms it', async () => {
    vi.mocked(approveAccount).mockResolvedValue({ account: {}, message: 'ok' });
    renderPage();

    const detail = await review('Priya Pending');
    expect(within(detail).getByText('Front Officer')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));

    const dialog = await screen.findByRole('dialog', { name: 'Approve registration' });
    expect(within(dialog).getByText(/not a role/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Approve' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'FRONT_OFFICE' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(approveAccount).toHaveBeenCalledWith('USR-p1', 'FRONT_OFFICE'));
    expect(notify.success).toHaveBeenCalledWith(
      'User approved successfully. The account is now active and can log in with the registered credentials.',
    );
  });

  it('offers an Admin no administrator roles, and a Super Admin both', async () => {
    const rolesOffered = async () => {
      fireEvent.click(within(await review('Priya Pending')).getByRole('button', { name: 'Approve' }));
      const select = within(await screen.findByRole('dialog', { name: 'Approve registration' })).getByLabelText('System role');
      return [...select.querySelectorAll('option')].map((option) => option.value).filter(Boolean);
    };

    const { unmount } = renderPage(ADMIN);
    const forAdmin = await rolesOffered();
    expect(forAdmin).not.toContain('ADMIN');
    expect(forAdmin).not.toContain('SUPER_ADMIN');
    expect(forAdmin).toContain('REVIEWER');
    unmount();

    renderPage(SUPER_ADMIN);
    expect(await rolesOffered()).toEqual(expect.arrayContaining(['ADMIN', 'SUPER_ADMIN']));
  });

  it('shows the server refusal inside the dialog', async () => {
    vi.mocked(approveAccount).mockRejectedValue({ response: { data: { error: 'Only a Super Admin can grant an administrator role' } } });
    renderPage();

    fireEvent.click(within(await review('Priya Pending')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve registration' });
    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'REVIEWER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only a Super Admin can grant an administrator role');
  });

  it('rejects with an optional reason', async () => {
    vi.mocked(rejectAccount).mockResolvedValue({ account: {}, message: 'Registration request rejected.' });
    renderPage();

    fireEvent.click(within(await review('Rohan Request')).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: /Reject Rohan Request/ });
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Please contact IPC.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));

    await waitFor(() => expect(rejectAccount).toHaveBeenCalledWith('USR-p2', 'Please contact IPC.'));
    expect(notify.success).toHaveBeenCalledWith('Registration request rejected.');
  });

  it('deactivates an approved account after confirming', async () => {
    vi.mocked(deactivateAccount).mockResolvedValue({ account: {}, message: 'Account deactivated.' });
    renderPage();
    await screen.findByText('Priya Pending');
    fireEvent.click(screen.getByRole('button', { name: /Approved users/ }));

    fireEvent.click(screen.getByRole('button', { name: 'View Asha Approved' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate account' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(deactivateAccount).toHaveBeenCalledWith('USR-a1'));
  });

  it('offers no actions on built-in accounts or on your own', async () => {
    renderPage(ADMIN, [...ACCOUNTS, account({ id: ADMIN.id, name: 'Me Myself', email: 'me@ipc.example', status: 'APPROVED', role: 'REVIEWER' })]);
    await screen.findByText('Priya Pending');
    fireEvent.click(screen.getByRole('button', { name: /Approved users/ }));

    fireEvent.click(screen.getByRole('button', { name: 'View Neha Singh' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/managed by configuration/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Deactivate|Change role/ })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });

    fireEvent.click(await screen.findByRole('button', { name: 'View Me Myself' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/your own account/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Deactivate|Change role/ })).toBeNull();
  });

  it('shows the rejection reason on a rejected request', async () => {
    renderPage();
    await screen.findByText('Priya Pending');
    fireEvent.click(screen.getByRole('button', { name: /Rejected requests/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View Ravi Rejected' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Not an IPC employee.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
