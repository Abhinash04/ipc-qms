import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { ThemeApplier } from '@/components/theme/ThemeApplier';
import { ThemeCustomizer } from '@/components/theme/ThemeCustomizer';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { Sidebar } from '@/components/layout/Sidebar';
import {
  useThemeStore,
  readSavedTheme,
  THEME_DEFAULTS,
  THEME_STORAGE_KEY,
} from '@/store/useThemeStore';
import { SIDEBAR_STORAGE_KEY } from '@/components/layout/sidebarState';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

const OIC = findUserById('USR-0003');
const root = document.documentElement;

function mockSystemScheme(dark) {
  const listeners = new Set();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
  }));
  return listeners;
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

beforeEach(() => {
  localStorage.clear();
  act(() => useThemeStore.getState().reset());
  root.className = '';
  root.removeAttribute('dir');
  delete window.matchMedia;
  useAuthStore.setState({ currentUser: OIC });
});

afterEach(() => {
  delete window.matchMedia;
});

describe('the theme store', () => {
  it('ignores unknown or invalid saved values', () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { mode: 'neon', preset: 'teal', dir: 'sideways', sidebarBoxed: 'yes' } }),
    );
    const saved = readSavedTheme();
    expect(saved.mode).toBe(THEME_DEFAULTS.mode);
    expect(saved.preset).toBe('teal');
    expect(saved.dir).toBe(THEME_DEFAULTS.dir);
    expect(saved.sidebarBoxed).toBe(false);
  });

  it('persists a change and refuses values outside the option list', () => {
    act(() => useThemeStore.getState().setOption('preset', 'violet'));
    act(() => useThemeStore.getState().setOption('preset', 'magenta'));
    expect(useThemeStore.getState().preset).toBe('violet');
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)).state.preset).toBe('violet');
  });
});

describe('ThemeApplier mirrors the store onto <html>', () => {
  it('applies the scheme, preset, sidebar, navbar and direction', () => {
    act(() => {
      const { setOption } = useThemeStore.getState();
      setOption('mode', 'dark');
      setOption('preset', 'teal');
      setOption('sidebarColor', 'color');
      setOption('navbarStyle', 'glass');
      setOption('dir', 'rtl');
    });
    render(<ThemeApplier />);

    expect(root).toHaveClass('dark');
    expect(root.dataset.preset).toBe('teal');
    expect(root.dataset.sidebarColor).toBe('color');
    expect(root.dataset.navbar).toBe('glass');
    expect(root.dir).toBe('rtl');
  });

  it('follows the operating system in auto mode', () => {
    mockSystemScheme(true);
    act(() => useThemeStore.getState().setOption('mode', 'auto'));
    render(<ThemeApplier />);
    expect(root).toHaveClass('dark');
  });

  it('stays light in auto mode when the system is light', () => {
    mockSystemScheme(false);
    act(() => useThemeStore.getState().setOption('mode', 'auto'));
    render(<ThemeApplier />);
    expect(root).not.toHaveClass('dark');
  });
});

describe('the theme customizer', () => {
  function renderCustomizer() {
    return render(
      <>
        <ThemeApplier />
        <ThemeCustomizer open onOpenChange={() => {}} />
      </>,
    );
  }

  it('switches the scheme and colour preset', () => {
    renderCustomizer();

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Scheme' })).getByRole('radio', { name: 'Dark' }));
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(root).toHaveClass('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'teal colour' }));
    expect(root.dataset.preset).toBe('teal');
  });

  it('flips direction and sidebar styling', () => {
    renderCustomizer();

    fireEvent.click(screen.getByRole('radio', { name: 'RTL' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Pill all' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Glass' }));

    expect(root.dir).toBe('rtl');
    expect(root.dataset.sidebarActive).toBe('pill-all');
    expect(root.dataset.navbar).toBe('glass');
  });

  it('drives the sidebar mini mode through the shared collapse key', () => {
    renderCustomizer();
    const mini = screen.getByRole('button', { name: /Mini/ });

    fireEvent.click(mini);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
    expect(mini).toHaveAttribute('aria-pressed', 'true');
  });

  it('resets everything to the defaults', () => {
    renderCustomizer();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Scheme' })).getByRole('radio', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(useThemeStore.getState().mode).toBe(THEME_DEFAULTS.mode);
    expect(root).not.toHaveClass('dark');
  });
});

describe('the command palette', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      queries: [
        {
          queryId: 'QRY-2026-00042',
          subject: 'Metformin reference standard',
          workflowState: 'PENDING_ASSIGNMENT',
          businessStatus: 'OPEN',
          createdAt: '2026-09-20T09:00:00.000Z',
        },
      ],
      workflowSteps: [],
      reviews: [],
    });
  });

  function renderPalette() {
    return render(
      <MemoryRouter initialEntries={['/officer-in-charge/dashboard']}>
        <CommandPalette open onOpenChange={() => {}} />
        <Routes>
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('finds a query in scope by subject and opens it on Enter', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: 'Search queries and pages' });

    fireEvent.change(input, { target: { value: 'metformin' } });
    const results = screen.getByRole('listbox', { name: 'Results' });
    expect(within(results).getByRole('option', { name: /Metformin reference standard/ })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/officer-in-charge/queries/QRY-2026-00042');
  });

  it('lists only pages the role is granted', () => {
    renderPalette();
    const options = within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option');
    const labels = options.map((o) => o.textContent);

    expect(labels.some((l) => l.includes('Approvals'))).toBe(true);
    expect(labels.some((l) => l.includes('System Settings'))).toBe(false);
  });
});

describe('the profile menu', () => {
  it('signs the user out', async () => {
    render(
      <MemoryRouter>
        <ProfileMenu onOpenSettings={() => {}} />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: /Signed in as/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(useAuthStore.getState().currentUser).toBeNull());
  });
});

describe('the Hindi interface toggle', () => {
  it('translates navigation labels without changing where they go', () => {
    useAuthStore.setState({ currentUser: findUserById('USR-0003') });
    act(() => useThemeStore.getState().setOption('lang', 'hi'));
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const dashboard = within(nav).getByRole('link', { name: 'डैशबोर्ड' });
    expect(dashboard).toHaveAttribute('href', '/officer-in-charge/dashboard');
  });
});
