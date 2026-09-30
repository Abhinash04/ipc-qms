import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

vi.mock('@/services/api/authService', () => ({
  login: vi.fn(),
  googleLogin: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchMe: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({ transport: 'mock', ipcQueryEmail: 'ipc-query-mock@example.com' }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
}));

import * as authService from '@/services/api/authService';

const OIC = findUserById('USR-0003');

let initialized;

function installFakeGoogle() {
  initialized = null;
  window.google = {
    accounts: {
      id: {
        initialize: vi.fn((config) => {
          initialized = config;
        }),
        renderButton: vi.fn((element) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Sign in with Google';
          button.addEventListener('click', () => initialized.callback({ credential: 'google-id-token' }));
          element.appendChild(button);
        }),
      },
    },
  };
}

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(authService.fetchMe).mockResolvedValue(null);
  useAuthStore.setState({ currentUser: null, authReady: true });
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

describe('Sign in with Google', () => {
  it('is not offered until VITE_GOOGLE_CLIENT_ID is configured', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    installFakeGoogle();
    renderLogin();

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('google-sign-in')).toBeNull();
    expect(screen.queryByText('Sign in with Google')).toBeNull();
    expect(window.google.accounts.id.initialize).not.toHaveBeenCalled();
  });

  it('renders Google\'s button with the configured client id', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    installFakeGoogle();
    renderLogin();

    expect(await screen.findByText('Sign in with Google')).toBeInTheDocument();
    expect(initialized.client_id).toBe('client-123.apps.googleusercontent.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends the Google credential to the server and lands on the role home', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    installFakeGoogle();
    vi.mocked(authService.googleLogin).mockResolvedValue(OIC);
    renderLogin();

    await act(async () => {
      fireEvent.click(await screen.findByText('Sign in with Google'));
    });

    expect(authService.googleLogin).toHaveBeenCalledWith('google-id-token');
    await waitFor(() => expect(useAuthStore.getState().currentUser).toEqual(OIC));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
  });

  it('shows the server\'s refusal for a Google account with no BRIDGETECH account', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    installFakeGoogle();
    const message = 'No BRIDGETECH account uses this Google email. Sign in with your BRIDGETECH email and password.';
    vi.mocked(authService.googleLogin).mockRejectedValue(
      Object.assign(new Error(message), { response: { status: 403, data: { code: 'NO_ACCOUNT', error: message } } }),
    );
    renderLogin();

    await act(async () => {
      fireEvent.click(await screen.findByText('Sign in with Google'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});
