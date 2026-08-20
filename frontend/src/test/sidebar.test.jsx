import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  Sidebar,
  WIDTH_CLOSED,
  RAIL_ITEM,
  RAIL_PADDING,
} from '@/components/layout/Sidebar';
import { useAuthStore } from '@/store/useAuthStore';
import { navItemsForRole } from '@/constants/navigation';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES, ROLE_LABELS } from '@/constants/roles';

const STORAGE_KEY = 'qms.sidebar.collapsed';
const EVERY_ROLE = Object.values(ROLES);
const userFor = (role) => MOCK_USERS.find((u) => u.role === role);

function renderSidebar({ collapsed = false } = {}) {
  localStorage.setItem(STORAGE_KEY, String(collapsed));
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Primary' });

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ currentUser: userFor(ROLES.SUPER_ADMIN) });
});

describe('collapsed geometry adds up', () => {
  it('leaves a content box exactly the width of a rail item', () => {

    expect(WIDTH_CLOSED - RAIL_PADDING * 2).toBe(RAIL_ITEM);
  });

  it('sits inside the intended 72-88px range', () => {
    expect(WIDTH_CLOSED).toBeGreaterThanOrEqual(72);
    expect(WIDTH_CLOSED).toBeLessThanOrEqual(88);
  });

  it('meets the 44px minimum pointer target', () => {
    expect(RAIL_ITEM).toBeGreaterThanOrEqual(44);
  });

  it('never allows the nav to scroll horizontally', () => {
    renderSidebar({ collapsed: true });
    expect(nav().className).toContain('overflow-x-hidden');
  });
});

describe('navigation comes from the permission system, in both states', () => {
  it.each(EVERY_ROLE)('renders exactly the granted items for %s when collapsed', (role) => {
    useAuthStore.setState({ currentUser: userFor(role) });
    renderSidebar({ collapsed: true });

    const expected = navItemsForRole(role);
    const links = within(nav()).getAllByRole('link');

    expect(links).toHaveLength(expected.length);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(expected.map((i) => i.path));
  });

  it.each(EVERY_ROLE)('renders the same items for %s when expanded', (role) => {
    useAuthStore.setState({ currentUser: userFor(role) });
    renderSidebar({ collapsed: false });

    const expected = navItemsForRole(role);
    const links = within(nav()).getAllByRole('link');

    expect(links.map((a) => a.getAttribute('href'))).toEqual(expected.map((i) => i.path));
  });

  it('grants no item the permission table withheld', () => {
    useAuthStore.setState({ currentUser: userFor(ROLES.INQUIRER) });
    renderSidebar({ collapsed: true });

    const hrefs = within(nav())
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));

    expect(hrefs.some((h) => h.includes('/queries'))).toBe(false);
    expect(hrefs.every((h) => h.startsWith('/inquirer/'))).toBe(true);
  });
});

describe('every icon-only control has an accessible name', () => {
  it('names each collapsed navigation item', () => {
    useAuthStore.setState({ currentUser: userFor(ROLES.OFFICER_IN_CHARGE) });
    renderSidebar({ collapsed: true });

    for (const item of navItemsForRole(ROLES.OFFICER_IN_CHARGE)) {
      expect(within(nav()).getByRole('link', { name: item.label })).toBeInTheDocument();
    }
  });

  it('names the avatar, sign out and the toggle', () => {
    const user = userFor(ROLES.REVIEWER);
    useAuthStore.setState({ currentUser: user });
    renderSidebar({ collapsed: true });

    expect(
      screen.getByRole('img', { name: `Signed in as ${user.name}, ${ROLE_LABELS[user.role]}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('keeps the avatar reachable by keyboard', () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole('img', { name: /Signed in as/ })).toHaveAttribute('tabindex', '0');
  });
});

describe('the active item is marked, and only it', () => {
  it('sets aria-current on the matching route alone', () => {
    useAuthStore.setState({ currentUser: userFor(ROLES.SUPER_ADMIN) });
    render(
      <MemoryRouter initialEntries={['/super-admin/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const current = within(nav())
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/super-admin/dashboard');
  });
});

describe('signing out works while collapsed', () => {
  it('clears the session — collapsing used to hide the only way out', () => {
    useAuthStore.setState({ currentUser: userFor(ROLES.ADMIN) });
    renderSidebar({ collapsed: true });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('still works while expanded', () => {
    useAuthStore.setState({ currentUser: userFor(ROLES.ADMIN) });
    renderSidebar({ collapsed: false });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe('collapsing and expanding', () => {
  it('shows labels and the section heading when expanded', () => {
    const [first] = navItemsForRole(ROLES.SUPER_ADMIN);

    renderSidebar({ collapsed: false });
    expect(within(nav()).getByText(first.label)).toBeInTheDocument();
    expect(screen.getByText('Main Menu')).toBeInTheDocument();
  });

  it('renders no visible labels in the rail when collapsed', () => {
    const [first] = navItemsForRole(ROLES.SUPER_ADMIN);
    renderSidebar({ collapsed: true });

    expect(within(nav()).queryByText(first.label)).toBeNull();
    expect(within(nav()).getByRole('link', { name: first.label })).toBeInTheDocument();
    expect(screen.queryByText('Main Menu')).toBeNull();
  });

  it('persists the choice and rehydrates from it', () => {
    renderSidebar({ collapsed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('starts collapsed when storage says so', () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });
});

