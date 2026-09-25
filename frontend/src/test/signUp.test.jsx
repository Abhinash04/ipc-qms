import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { notify } from '@/services/notify';
import * as authService from '@/services/api/authService';

vi.mock('@/services/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/services/api/authService', () => ({
  login: vi.fn(),
  register: vi.fn(),
  googleAuth: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchMe: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

function renderApp(path = '/signup') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: null, authReady: true });
});

describe('Sign Up page UI & Navigation', () => {
  it('renders all required form fields including Role and Create Account button on /signup', async () => {
    renderApp('/signup');

    expect(await screen.findByRole('heading', { name: 'Sign Up' })).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Department')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
  });

  it('navigates from Sign Up to Sign In page when clicking Sign In link', async () => {
    renderApp('/signup');

    const signInLink = await screen.findByRole('link', { name: 'Sign In' });
    fireEvent.click(signInLink);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('navigates from Sign In to Sign Up page when clicking Sign Up link', async () => {
    renderApp('/login');

    const signUpLink = await screen.findByRole('link', { name: 'Sign Up' });
    fireEvent.click(signUpLink);

    expect(await screen.findByRole('heading', { name: 'Sign Up' })).toBeInTheDocument();
  });
});

describe('Sign Up form validation & backend API call', () => {
  it('shows error when required fields are empty', async () => {
    renderApp('/signup');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('All fields are required.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('shows error when email format is invalid', async () => {
    renderApp('/signup');

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Secret123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('shows error when Password and Confirm Password do not match', async () => {
    renderApp('/signup');

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@ipc.example' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Different456' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Password and Confirm Password do not match.');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('displays duplicate email error when API returns 409 Conflict', async () => {
    vi.mocked(authService.register).mockRejectedValue({
      response: { status: 409, data: { message: 'An account with this email already exists' } },
    });

    renderApp('/signup');

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'existing@ipc.example' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Secret123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists');
  });

  it('successfully calls API with form fields & selected role, shows toast, and navigates to Sign In page', async () => {
    vi.mocked(authService.register).mockResolvedValue({ success: true, message: 'Account created successfully' });

    renderApp('/signup');

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@ipc.example' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'REVIEWER' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Secret123' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });

    expect(authService.register).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane@ipc.example',
      department: 'QA',
      role: 'REVIEWER',
      password: 'Secret123',
      confirmPassword: 'Secret123',
    });

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Account created successfully! Please sign in.');
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('Continue with Google button flow', () => {
  it('shows controlled error when VITE_GOOGLE_CLIENT_ID is not configured', async () => {
    const originalClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    import.meta.env.VITE_GOOGLE_CLIENT_ID = '';

    renderApp('/signup');

    const googleBtn = screen.getByRole('button', { name: 'Continue with Google' });

    await act(async () => {
      fireEvent.click(googleBtn);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Google Sign Up is not configured yet.');
    expect(authService.googleAuth).not.toHaveBeenCalled();

    import.meta.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
  });

  it('shows department required error when backend returns DEPARTMENT_REQUIRED', async () => {
    vi.mocked(authService.googleAuth).mockRejectedValue({
      response: { status: 400, data: { code: 'DEPARTMENT_REQUIRED', message: 'Please select a Department' } },
    });

    const originalClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'dummy-client-id';

    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(({ callback }) => {
            callback({ credential: 'mock-google-id-token' });
          }),
          prompt: vi.fn(),
        },
      },
    };

    renderApp('/signup');

    const googleBtn = screen.getByRole('button', { name: 'Continue with Google' });

    await act(async () => {
      fireEvent.click(googleBtn);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Please select your Department using the Department field above to complete registration.');

    import.meta.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
    delete window.google;
  });
});

describe('signed in user redirect', () => {
  it('redirects signed-in user away from /signup to their home dashboard', async () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0005'), authReady: true });
    renderApp('/signup');

    expect(await screen.findByRole('heading', { name: /Dashboard$|My Queries$/ })).toBeInTheDocument();
  });
});
