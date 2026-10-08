import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROUTE_PATHS } from '@/constants/routePaths';

vi.mock('@/services/api/authService', () => ({
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchMe: vi.fn().mockResolvedValue(null),
  register: vi.fn().mockResolvedValue({ success: true, message: 'Account created successfully' }),
}));

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

function renderApp(path = ROUTE_PATHS.LOGIN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: null, authReady: true });
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('Sign Up page and navigation', () => {
  it('navigates from Sign In to Sign Up page when clicking Sign Up link', async () => {
    renderApp(ROUTE_PATHS.LOGIN);

    const signUpLink = await screen.findByRole('link', { name: 'Sign Up' });
    expect(signUpLink).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(signUpLink);
    });

    expect(await screen.findByRole('heading', { name: 'Sign Up' })).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Department')).toBeInTheDocument();
    expect(screen.getByLabelText('Designation')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('navigates from Sign Up to Sign In page when clicking Sign In link', async () => {
    renderApp(ROUTE_PATHS.SIGNUP);

    const signInLink = await screen.findByRole('link', { name: 'Sign In' });
    expect(signInLink).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(signInLink);
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows error messages when required fields are empty on submission', async () => {
    renderApp(ROUTE_PATHS.SIGNUP);

    await screen.findByRole('heading', { name: 'Sign Up' });

    const submitBtn = screen.getByRole('button', { name: /Create Account/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(await screen.findByText('Full Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Department is required.')).toBeInTheDocument();
    expect(screen.getByText('Designation is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(screen.getByText('Confirm Password is required.')).toBeInTheDocument();
  });

  it('shows error message on invalid email format', async () => {
    renderApp(ROUTE_PATHS.SIGNUP);

    await screen.findByRole('heading', { name: 'Sign Up' });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid-email' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Department'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Quality Assurance & Standards' }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Designation'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }));

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'secret123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  it('shows error message when Password and Confirm Password do not match', async () => {
    renderApp(ROUTE_PATHS.SIGNUP);

    await screen.findByRole('heading', { name: 'Sign Up' });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@ipc.example' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Department'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Quality Assurance & Standards' }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Designation'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }));

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    expect(await screen.findByText('Password and Confirm Password must match.')).toBeInTheDocument();
  });

  it('submits successfully when form is valid and redirects to Sign In', async () => {
    renderApp(ROUTE_PATHS.SIGNUP);

    await screen.findByRole('heading', { name: 'Sign Up' });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@ipc.example' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Department'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Quality Assurance & Standards' }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Designation'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }));

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
  });

  it('asks for a password of at least 8 characters, as the server does', async () => {
    const { register } = await import('@/services/api/authService');
    renderApp(ROUTE_PATHS.SIGNUP);
    await screen.findByRole('heading', { name: 'Sign Up' });

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'short1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('says new accounts need approval, and sends the request without any role', async () => {
    const { register } = await import('@/services/api/authService');
    renderApp(ROUTE_PATHS.SIGNUP);
    await screen.findByRole('heading', { name: 'Sign Up' });

    expect(screen.getByText(/administrator approves new accounts/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Jane@IPC.example' } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Department'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Quality Assurance & Standards' }));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Designation'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Super Admin' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(register).mock.calls[0][0];
    expect(payload).toMatchObject({ designation: 'Super Admin', email: 'Jane@IPC.example' });
    expect(payload).not.toHaveProperty('role');
  });

  it('shows the server\'s "awaiting approval" message when a pending account signs in', async () => {
    const { login } = await import('@/services/api/authService');
    vi.mocked(login).mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), {
        response: { status: 403, data: { error: 'Your account is awaiting approval by an administrator.' } },
      }),
    );
    renderApp(ROUTE_PATHS.LOGIN);
    await screen.findByRole('heading', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@ipc.example' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Your account is awaiting approval by an administrator.');
  });

  it('handles duplicate email 409 conflict error from backend', async () => {
    const { register } = await import('@/services/api/authService');
    const conflictError = Object.assign(new Error('Conflict'), {
      response: { status: 409, data: { message: 'An account with this email already exists' } },
    });
    vi.mocked(register).mockRejectedValueOnce(conflictError);

    renderApp(ROUTE_PATHS.SIGNUP);

    await screen.findByRole('heading', { name: 'Sign Up' });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'duplicate@ipc.example' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Department'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Quality Assurance & Standards' }));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Designation'));
    });
    fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }));

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    });

    expect(await screen.findByText('An account with this email already exists. Please sign in.')).toBeInTheDocument();
  });
});
