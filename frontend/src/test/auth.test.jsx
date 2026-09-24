import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { roleHome } from '@/constants/routePaths';

vi.mock('@/services/api/authService', () => ({
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchMe: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd@example.com', name: 'AR&D Division' },
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

import * as authService from '@/services/api/authService';

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

async function signInThroughForm(email, password) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
}

const httpError = (status, message) =>
  Object.assign(new Error(message), { response: { status, data: { error: message } } });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(authService.logout).mockResolvedValue(undefined);
  vi.mocked(authService.fetchMe).mockResolvedValue(null);
  useAuthStore.setState({ currentUser: null, authReady: true });
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('the login form talks to the server', () => {
  it('starts signed out — no user is assumed', () => {
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('never shows a password on screen — the shared demo password is gone', () => {
    renderApp();
    expect(screen.queryByText(/ipc@1234/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mock Credentials/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use Credentials/i })).not.toBeInTheDocument();
  });

  it('posts the typed credentials and stores the user the server returns', async () => {
    const user = findUserById('USR-0005');
    vi.mocked(authService.login).mockResolvedValue(user);

    renderApp();
    await signInThroughForm(user.email, 'a-real-password');

    expect(authService.login).toHaveBeenCalledWith(user.email, 'a-real-password');
    await waitFor(() => expect(useAuthStore.getState().currentUser).toEqual(user));
  });

  it('shows the server message and stays signed out on bad credentials', async () => {
    vi.mocked(authService.login).mockRejectedValue(httpError(401, 'Invalid email or password'));

    renderApp();
    await signInThroughForm('nobody@ipc.example', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('does not decide who you are locally — an unknown email still goes to the server', async () => {
    vi.mocked(authService.login).mockRejectedValue(httpError(401, 'Invalid email or password'));

    renderApp();
    await signInThroughForm('stranger@example.com', 'whatever');

    expect(authService.login).toHaveBeenCalledWith('stranger@example.com', 'whatever');
  });

  it('keeps a signed-in user off the login page', async () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });
    renderApp('/login');

    expect(await screen.findByRole('heading', { name: DASHBOARD_HEADING })).toBeInTheDocument();
  });
});

describe('every user can sign in and lands on their own dashboard', () => {
  it.each(MOCK_USERS.map((user) => [`${user.name} (${user.role})`, user]))(
    '%s',
    async (_label, user) => {
      vi.mocked(authService.login).mockResolvedValue(user);

      renderApp();
      await signInThroughForm(user.email, 'a-real-password');

      await waitFor(() => expect(useAuthStore.getState().currentUser?.id).toBe(user.id));
      expect(roleHome(user.role)).toMatch(/^\//);
      expect(await screen.findByRole('heading', { name: DASHBOARD_HEADING })).toBeInTheDocument();
      expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
    },
  );
});

describe('the session is the cookie, not local storage', () => {
  it('restores the signed-in user from GET /auth/me on boot', async () => {
    const user = findUserById('USR-0002');
    vi.mocked(authService.fetchMe).mockResolvedValue(user);

    useAuthStore.setState({ currentUser: null, authReady: false });
    await act(async () => {
      await useAuthStore.getState().hydrate();
    });

    expect(authService.fetchMe).toHaveBeenCalled();
    expect(useAuthStore.getState().currentUser).toEqual(user);
    expect(useAuthStore.getState().authReady).toBe(true);
  });

  it('resolves to signed out when there is no session', async () => {
    vi.mocked(authService.fetchMe).mockResolvedValue(null);

    useAuthStore.setState({ currentUser: null, authReady: false });
    await act(async () => {
      await useAuthStore.getState().hydrate();
    });

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().authReady).toBe(true);
  });

  it('writes nothing about the user to localStorage', async () => {
    const user = findUserById('USR-0005');
    vi.mocked(authService.login).mockResolvedValue(user);

    renderApp();
    await signInThroughForm(user.email, 'a-real-password');
    await waitFor(() => expect(useAuthStore.getState().currentUser).toEqual(user));

    expect(localStorage.getItem('qms.auth')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('amit.mehta');
  });

  it('a network failure during boot resolves to signed out rather than hanging', async () => {
    vi.mocked(authService.fetchMe).mockRejectedValue(new Error('Network Error'));

    useAuthStore.setState({ currentUser: null, authReady: false });
    await act(async () => {
      await useAuthStore.getState().hydrate();
    });

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().authReady).toBe(true);
  });
});

describe('signing out', () => {
  it('asks the server to clear the cookie, then clears the user', async () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(authService.logout).toHaveBeenCalled();
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('clears the user even when the server call fails', async () => {
    vi.mocked(authService.logout).mockRejectedValue(new Error('Network Error'));
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });

    await act(async () => {
      await useAuthStore.getState().logout().catch(() => {});
    });

    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('sends the user back to the login page', async () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });
    renderApp('/reviewer/dashboard');

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('an expired session is handled centrally', () => {
  it('clearSession drops the user, as the 401 interceptor does', () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });

    useAuthStore.getState().clearSession();

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().authReady).toBe(true);
  });
});

describe('routes decide nothing before the session is known', () => {
  it('renders neither the page nor the login redirect while /auth/me is in flight', () => {
    useAuthStore.setState({ currentUser: null, authReady: false });
    renderApp('/reviewer/dashboard');

    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
  });

  it('redirects to login once the session resolves to nobody', async () => {
    useAuthStore.setState({ currentUser: null, authReady: false });
    renderApp('/reviewer/dashboard');

    await act(async () => {
      useAuthStore.setState({ authReady: true });
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('role boundaries still hold after the auth change', () => {
  it('refuses a route outside the signed-in role', async () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0009'), authReady: true });
    renderApp('/officer-in-charge/dashboard');

    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
  });

  it('distinguishes Rawat Jatin from the Officer-in-Charge with the similar name', () => {
    const assignedOfficial = findUserById('USR-0009');
    const officerInCharge = findUserById('USR-0003');

    expect(assignedOfficial.name).toBe('Rawat Jatin');
    expect(assignedOfficial.role).toBe('ASSIGNED_OFFICIAL');
    expect(officerInCharge.name).toBe('Jatin Rawat');
    expect(officerInCharge.role).toBe('OFFICER_IN_CHARGE');
    expect(assignedOfficial.email).not.toBe(officerInCharge.email);
  });
});
