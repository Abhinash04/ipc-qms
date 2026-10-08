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
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  resetAccountPassword: vi.fn(),
}));
vi.mock('@/services/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/services/api/adminService');
vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy', service: 'qms-backend' }),
}));
vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({ transport: 'mock', ipcQueryEmail: 'ipc@test.invalid', participants: [] }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
}));

import { AppRoutes } from '@/routes/AppRoutes';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { notify } from '@/services/notify';
import {
  fetchAccounts,
  approveAccount,
  deactivateAccount,
  createAccount,
  updateAccount,
  resetAccountPassword,
} from '@/services/api/userAdminService';

const ADMIN = findUserById('USR-0007');
const SUPER_ADMIN = findUserById('USR-0008');

const account = (overrides) => ({
  department: 'Quality Assurance',
  requestedDesignation: 'Scientific Officer',
  role: null,
  divisionId: null,
  expertise: [],
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
  account({ id: 'USR-a1', name: 'Asha Approved', email: 'asha@ipc.example', status: 'APPROVED', role: 'REVIEWER' }),
  account({
    id: 'USR-o1',
    name: 'Omar Officer',
    email: 'omar@ipc.example',
    status: 'APPROVED',
    role: 'ASSIGNED_OFFICIAL',
    divisionId: 'DIV-008',
    expertise: ['nitrosamine'],
  }),
  account({ id: 'USR-ad1', name: 'Anil Admin', email: 'anil@ipc.example', status: 'APPROVED', role: 'ADMIN' }),
  account({
    id: 'USR-0004',
    name: 'Neha Singh',
    email: 'neha.singh@ipc.example',
    status: 'APPROVED',
    role: 'ASSIGNED_OFFICIAL',
    source: 'built-in',
    divisionId: 'DIV-005',
    expertise: ['assay', 'dissolution'],
  }),
];
const COUNTS = { PENDING: 1, APPROVED: 4, REJECTED: 0, DEACTIVATED: 0 };

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage(viewer = ADMIN) {
  useAuthStore.setState({ currentUser: viewer, authReady: true });
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderRoute(viewer, path) {
  useAuthStore.setState({ currentUser: viewer, authReady: true });
  return render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const showApproved = async () => {
  await screen.findByText('Priya Pending');
  fireEvent.click(screen.getByRole('button', { name: /Approved users/ }));
};

async function openMenu(name) {
  const trigger = await screen.findByRole('button', { name: `Actions for ${name}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}
const menuItems = (menu) => within(menu).getAllByRole('menuitem').map((item) => item.textContent.trim());

async function openAddUser() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add User' }));
  return screen.findByRole('dialog', { name: 'Add user' });
}

function fillNewUser(dialog, overrides = {}) {
  const values = {
    'Full name': 'Nina New',
    Email: 'Nina.New@IPC.example',
    Designation: 'Scientific Officer',
    Password: 'Welcome12345',
    'Confirm password': 'Welcome12345',
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  }
}

const roleOptions = (dialog) =>
  [...within(dialog).getByLabelText('System role').querySelectorAll('option')].map((o) => o.value).filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAccounts).mockResolvedValue({ accounts: ACCOUNTS, counts: COUNTS });
});

describe('Add User', () => {
  it.each([
    ['an Admin', ADMIN, '/admin/users'],
    ['a Super Admin', SUPER_ADMIN, '/super-admin/users'],
  ])('opens for %s at %s', async (_label, viewer, path) => {
    renderRoute(viewer, path);
    const dialog = await openAddUser();
    expect(within(dialog).getByLabelText('Full name')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Password')).toBeInTheDocument();
  });

  it('offers an Admin no administrator roles, and a Super Admin both', async () => {
    const { unmount } = renderPage(ADMIN);
    const forAdmin = roleOptions(await openAddUser());
    expect(forAdmin).toContain('ASSIGNED_OFFICIAL');
    expect(forAdmin).not.toContain('ADMIN');
    expect(forAdmin).not.toContain('SUPER_ADMIN');
    unmount();

    renderPage(SUPER_ADMIN);
    expect(roleOptions(await openAddUser())).toEqual(expect.arrayContaining(['ADMIN', 'SUPER_ADMIN']));
  });

  it('asks for a division and expertise only for an Assigned Official, and sends them', async () => {
    vi.mocked(createAccount).mockResolvedValue({ account: {}, message: 'User created.' });
    renderPage();
    const dialog = await openAddUser();
    fillNewUser(dialog);

    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'REVIEWER' } });
    expect(within(dialog).queryByLabelText('Areas of expertise')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'ASSIGNED_OFFICIAL' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByText('Add at least one area of expertise.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose the division this officer works in.')).toBeInTheDocument();
    expect(createAccount).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Division'), { target: { value: 'DIV-008' } });
    const expertise = within(dialog).getByLabelText('Areas of expertise', { selector: 'input' });
    fireEvent.change(expertise, { target: { value: 'Nitrosamine Impurities' } });
    fireEvent.keyDown(expertise, { key: 'Enter' });
    fireEvent.change(expertise, { target: { value: 'NDMA,' } });
    expect(within(dialog).getByRole('button', { name: 'Remove ndma' })).toBeInTheDocument();

    const fetchesBefore = vi.mocked(fetchAccounts).mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));

    await waitFor(() =>
      expect(createAccount).toHaveBeenCalledWith({
        name: 'Nina New',
        email: 'nina.new@ipc.example',
        department: '',
        designation: 'Scientific Officer',
        role: 'ASSIGNED_OFFICIAL',
        divisionId: 'DIV-008',
        expertise: ['nitrosamine impurities', 'ndma'],
        password: 'Welcome12345',
        confirmPassword: 'Welcome12345',
      }),
    );
    expect(notify.success).toHaveBeenCalledWith('User created.');
    await waitFor(() => expect(vi.mocked(fetchAccounts).mock.calls.length).toBeGreaterThan(fetchesBefore));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add user' })).toBeNull());
  });

  it('checks the password before sending anything', async () => {
    renderPage();
    const dialog = await openAddUser();
    fillNewUser(dialog, { 'Confirm password': 'Different123' });
    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'REVIEWER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByText('The passwords do not match.')).toBeInTheDocument();

    fillNewUser(dialog, { Password: 'short', 'Confirm password': 'short' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server refusal', async () => {
    vi.mocked(createAccount).mockRejectedValue({ response: { data: { error: 'An account with this email already exists' } } });
    renderPage();
    const dialog = await openAddUser();
    fillNewUser(dialog);
    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'REVIEWER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An account with this email already exists');
  });
});

describe('the actions menu', () => {
  it('offers only View details on a built-in account and on an administrator, for an Admin', async () => {
    renderPage(ADMIN);
    await showApproved();
    expect(menuItems(await openMenu('Neha Singh'))).toEqual(['View details']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(menuItems(await openMenu('Anil Admin'))).toEqual(['View details']);
  });

  it('lets a Super Admin manage an administrator', async () => {
    renderPage(SUPER_ADMIN);
    await showApproved();
    expect(menuItems(await openMenu('Anil Admin'))).toEqual([
      'View details',
      'Edit user',
      'Change role',
      'Reset password',
      'Deactivate user',
    ]);
  });

  it('offers review actions on a pending request', async () => {
    renderPage();
    expect(menuItems(await openMenu('Priya Pending'))).toEqual(['View details', 'Edit user', 'Approve request', 'Reject request']);
  });

  it('opens the details', async () => {
    renderPage();
    await showApproved();
    fireEvent.click(within(await openMenu('Omar Officer')).getByRole('menuitem', { name: 'View details' }));
    const dialog = await screen.findByRole('dialog', { name: /Omar Officer/ });
    expect(within(dialog).getByText('Pharmaceutical Chemistry')).toBeInTheDocument();
    expect(within(dialog).getByText('nitrosamine')).toBeInTheDocument();
  });

  it('confirms before deactivating, naming the person, and only then calls the server', async () => {
    vi.mocked(deactivateAccount).mockResolvedValue({ account: {}, message: 'Account deactivated.' });
    renderPage();
    await showApproved();
    fireEvent.click(within(await openMenu('Asha Approved')).getByRole('menuitem', { name: 'Deactivate user' }));

    const confirm = await screen.findByRole('dialog', { name: 'Deactivate account' });
    expect(confirm).toHaveTextContent('Asha Approved (asha@ipc.example)');
    expect(deactivateAccount).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deactivateAccount).toHaveBeenCalledWith('USR-a1'));
    expect(notify.success).toHaveBeenCalledWith('Account deactivated.');
  });

  it('approves a request as an Assigned Official only with a division and expertise', async () => {
    vi.mocked(approveAccount).mockResolvedValue({ account: {}, message: 'ok' });
    renderPage();
    fireEvent.click(within(await openMenu('Priya Pending')).getByRole('menuitem', { name: 'Approve request' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve registration' });

    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'ASSIGNED_OFFICIAL' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText('Add at least one area of expertise.')).toBeInTheDocument();
    expect(approveAccount).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Division'), { target: { value: 'DIV-007' } });
    const expertise = within(dialog).getByLabelText('Areas of expertise', { selector: 'input' });
    fireEvent.change(expertise, { target: { value: 'sterility' } });
    fireEvent.keyDown(expertise, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(approveAccount).toHaveBeenCalledWith('USR-p1', 'ASSIGNED_OFFICIAL', { divisionId: 'DIV-007', expertise: ['sterility'] }),
    );
  });
});

describe('Edit User', () => {
  async function editFromMenu(name) {
    await showApproved();
    fireEvent.click(within(await openMenu(name)).getByRole('menuitem', { name: 'Edit user' }));
    return screen.findByRole('dialog', { name: `Edit ${name}` });
  }

  it('sends only what changed, including an officer’s expertise', async () => {
    vi.mocked(updateAccount).mockResolvedValue({ account: {}, message: 'User updated.' });
    renderPage();
    const dialog = await editFromMenu('Omar Officer');

    expect(within(dialog).getByLabelText('Full name')).toHaveValue('Omar Officer');
    expect(within(dialog).getByLabelText('Division')).toHaveValue('DIV-008');
    expect(within(dialog).queryByLabelText('Password')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Full name'), { target: { value: 'Omar Farooq' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove nitrosamine' }));
    const expertise = within(dialog).getByLabelText('Areas of expertise', { selector: 'input' });
    fireEvent.change(expertise, { target: { value: 'elemental impurities' } });
    fireEvent.keyDown(expertise, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateAccount).toHaveBeenCalledWith('USR-o1', { name: 'Omar Farooq', expertise: ['elemental impurities'] }),
    );
    expect(notify.success).toHaveBeenCalledWith('User updated.');
  });

  it('changes the role and switches the account off', async () => {
    vi.mocked(updateAccount).mockResolvedValue({ account: {}, message: 'User updated.' });
    renderPage();
    const dialog = await editFromMenu('Asha Approved');

    fireEvent.change(within(dialog).getByLabelText('System role'), { target: { value: 'FRONT_OFFICE' } });
    fireEvent.click(within(dialog).getByLabelText(/Active/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith('USR-a1', { role: 'FRONT_OFFICE', active: false }));
  });

  it('says so when nothing has changed', async () => {
    renderPage();
    const dialog = await editFromMenu('Asha Approved');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing has changed yet.');
    expect(updateAccount).not.toHaveBeenCalled();
  });
});

describe('Reset password', () => {
  it('sets a new password after checking it matches', async () => {
    vi.mocked(resetAccountPassword).mockResolvedValue({ account: {}, message: 'Password reset.' });
    renderPage();
    await showApproved();
    fireEvent.click(within(await openMenu('Asha Approved')).getByRole('menuitem', { name: 'Reset password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset password' });

    fireEvent.change(within(dialog).getByLabelText('New password'), { target: { value: 'NewPassword99' } });
    fireEvent.change(within(dialog).getByLabelText('Confirm new password'), { target: { value: 'NewPassword98' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    expect(await within(dialog).findByText('The passwords do not match.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Confirm new password'), { target: { value: 'NewPassword99' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(resetAccountPassword).toHaveBeenCalledWith('USR-a1', 'NewPassword99', 'NewPassword99'));
  });
});

describe('loading and errors', () => {
  it('shows the list loading, then a retry when it fails', async () => {
    vi.mocked(fetchAccounts).mockRejectedValueOnce({ response: { data: { error: 'Database offline' } } });
    renderPage();
    expect(screen.getByText('Loading accounts…')).toBeInTheDocument();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Database offline');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Priya Pending')).toBeInTheDocument();
  });
});
