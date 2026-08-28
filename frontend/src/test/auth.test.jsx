import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { MOCK_USERS, MOCK_PASSWORD, findUserById } from '@/constants/mockUsers';
import { ROLE_LABELS, ROLES } from '@/constants/roles';
import { roleHome } from '@/constants/routePaths';
import { navItemsForRole } from '@/constants/navigation';
import { isRouteAllowedForRole } from '@/constants/permissions';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd@example.com', name: 'AR&D Division' },
    inquirer: { email: 'abhinash.pritiraj@gmail.com', name: 'Abhinash Pritiraj' },
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendEnquiry: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-1' }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

// Each role renders its own dashboard heading — "Reviewer Dashboard",
// "Front Office Dashboard", and "My Queries" for the Inquirer.
const DASHBOARD_HEADING = /Dashboard$|My Queries$/;

function renderApp(path = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openMockCredentials() {
  fireEvent.click(screen.getByRole('button', { name: /Mock Credentials/i }));
}

function signInThroughForm(user, password = MOCK_PASSWORD) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(async () => {
  useAuthStore.setState({ currentUser: null });
  localStorage.removeItem('qms.auth');
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

afterEach(() => {
  localStorage.removeItem('qms.auth');
});

describe('login form', () => {
  it('starts signed out — no user is assumed', () => {
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('sends an unauthenticated visitor to the login page', async () => {
    renderApp('/front-officer/queries');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lists every mock user with their role', () => {
    renderApp();
    openMockCredentials();
    for (const user of MOCK_USERS) {
      expect(screen.getByText(user.name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^Use Credentials for / })).toHaveLength(
      MOCK_USERS.length,
    );
    expect(screen.getAllByText(ROLE_LABELS.REVIEWER).length).toBeGreaterThan(0);
  });

  it('fills the form from Use Credentials', () => {
    renderApp();
    openMockCredentials();
    const frontOfficer = MOCK_USERS.find((u) => u.role === 'FRONT_OFFICE');

    fireEvent.click(
      screen.getByRole('button', { name: `Use Credentials for ${frontOfficer.name}` }),
    );

    expect(screen.getByLabelText('Email')).toHaveValue(frontOfficer.email);
    expect(screen.getByLabelText('Password')).toHaveValue(MOCK_PASSWORD);
  });

  it('rejects a wrong password', async () => {
    renderApp();
    signInThroughForm(MOCK_USERS[0], 'not-the-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('rejects an unknown email', async () => {
    renderApp();
    signInThroughForm({ email: 'nobody@ipc.example' });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe('every mock user can log in and lands on their own dashboard', () => {
  it.each(MOCK_USERS.map((user) => [`${user.name} (${user.role})`, user]))(
    '%s',
    async (_label, user) => {
      renderApp();
      signInThroughForm(user);

      await waitFor(() => {
        expect(useAuthStore.getState().currentUser?.id).toBe(user.id);
      });

      expect(
        await screen.findByRole('heading', { name: DASHBOARD_HEADING }, { timeout: 4000 }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(user.name)).length).toBeGreaterThan(0);
    },
  );

  it('maps each role to a distinct role-prefixed home', () => {
    const homes = MOCK_USERS.map((user) => roleHome(user.role));
    expect(homes).toContain('/inquirer/dashboard');
    expect(homes).toContain('/front-officer/dashboard');
    expect(homes).toContain('/officer-in-charge/dashboard');
    expect(homes).toContain('/assigned-official/dashboard');
    expect(homes).toContain('/reviewer/dashboard');
    expect(homes).toContain('/super-admin/dashboard');
  });
});

describe('session', () => {
  it('keeps a signed-in user off the login page', async () => {
    useAuthStore.getState().login('USR-0002');
    renderApp('/login');

    expect(await screen.findByRole('heading', { name: DASHBOARD_HEADING })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('persists only the user id, so a refresh keeps the session', () => {
    useAuthStore.getState().login('USR-0005');

    const stored = JSON.parse(localStorage.getItem('qms.auth'));
    expect(stored.state).toEqual({ userId: 'USR-0005' });
    expect(JSON.stringify(stored)).not.toContain('amit.mehta');
  });

  it('logout clears the session and the stored id', () => {
    useAuthStore.getState().login('USR-0003');
    useAuthStore.getState().logout();

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(JSON.parse(localStorage.getItem('qms.auth')).state).toEqual({ userId: null });
  });

  it('logging out sends the user back to the login page', async () => {
    useAuthStore.getState().login('USR-0002');
    renderApp('/front-officer/dashboard');

    act(() => useAuthStore.getState().logout());

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a stored id that no longer exists fails closed to signed out', () => {
    const rehydrated = useAuthStore.persist.getOptions().merge({ userId: 'USR-9999' }, {});
    expect(rehydrated.currentUser).toBeNull();
  });

  it('a stored id rehydrates into the full user record', () => {
    const rehydrated = useAuthStore.persist.getOptions().merge({ userId: 'USR-0002' }, {});
    expect(rehydrated.currentUser).toMatchObject({ id: 'USR-0002', name: 'Bhumika Makker' });
  });
});

describe('Rawat Jatin — a mock Assigned Official', () => {
  const RAWAT = findUserById('USR-0009');

  it('exists as an ASSIGNED_OFFICIAL with a mock address', () => {
    expect(RAWAT.role).toBe(ROLES.ASSIGNED_OFFICIAL);
    expect(RAWAT.email).toBe('rawat.jatin@ipc.example');
  });

  it('appears on the login page with his role', () => {
    renderApp();
    openMockCredentials();
    expect(screen.getByText('Rawat Jatin')).toBeInTheDocument();
  });

  it('logs in with the development credentials', async () => {
    renderApp();
    signInThroughForm(RAWAT);

    await waitFor(() => {
      expect(useAuthStore.getState().currentUser?.id).toBe('USR-0009');
    });
    expect(useAuthStore.getState().currentUser.email).toBe(RAWAT.email);
  });

  it('lands on /assigned-official/dashboard after login', async () => {
    expect(roleHome(RAWAT.role)).toBe('/assigned-official/dashboard');

    renderApp();
    signInThroughForm(RAWAT);

    expect(await screen.findByRole('heading', { name: DASHBOARD_HEADING })).toBeInTheDocument();
    expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Rawat Jatin/).length).toBeGreaterThan(0);
  });

  it('sees the Assigned Official navigation', async () => {
    renderApp();
    signInThroughForm(RAWAT);
    await screen.findByRole('heading', { name: DASHBOARD_HEADING });

    const labels = navItemsForRole(RAWAT.role).map((item) => item.label);
    expect(labels).toEqual(['Dashboard', 'Queries', 'My Work', 'Drafting', 'Notifications']);

    for (const item of navItemsForRole(RAWAT.role)) {
      expect(isRouteAllowedForRole(RAWAT.role, item.path)).toBe(true);
    }
  });

  it('is refused every route outside his role', async () => {
    for (const path of [
      '/officer-in-charge/dashboard',
      '/officer-in-charge/approvals',
      '/front-officer/inbox',
      '/front-officer/dispatch',
      '/inquirer/compose',
      '/super-admin/users',
      '/reviewer/reviews',
    ]) {
      expect(isRouteAllowedForRole(RAWAT.role, path), path).toBe(false);
    }

    useAuthStore.setState({ currentUser: RAWAT });
    renderApp('/officer-in-charge/approvals');
    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
  });

  it('is a different account from the Officer-in-Charge with the similar name', () => {
    const jatin = findUserById('USR-0003');

    expect(jatin.name).toBe('Jatin Rawat');
    expect(RAWAT.name).toBe('Rawat Jatin');
    expect(jatin.email).not.toBe(RAWAT.email);
    expect(jatin.role).not.toBe(RAWAT.role);

    useAuthStore.getState().login('USR-0009');
    expect(useAuthStore.getState().currentUser.email).toBe(RAWAT.email);

    useAuthStore.getState().login('USR-0003');
    expect(useAuthStore.getState().currentUser.email).toBe(jatin.email);
  });

  it('keeps the mock Assigned Official usable alongside him', async () => {
    const neha = findUserById('USR-0004');
    expect(neha.role).toBe(ROLES.ASSIGNED_OFFICIAL);

    renderApp();
    signInThroughForm(neha);

    await waitFor(() => {
      expect(useAuthStore.getState().currentUser?.id).toBe('USR-0004');
    });
    expect(await screen.findByRole('heading', { name: DASHBOARD_HEADING })).toBeInTheDocument();
  });
});

