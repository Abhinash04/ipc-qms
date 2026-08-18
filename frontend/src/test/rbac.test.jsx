import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { ROLE_ROUTES } from '@/routes/roleRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLES } from '@/constants/roles';
import { SECTION, SECTIONS } from '@/constants/routeSections';
import {
  ROLE_SLUG,
  sectionsForRole,
  isRouteAllowedForRole,
  roleHasSection,
} from '@/constants/permissions';
import { navItemsForRole } from '@/constants/navigation';
import { pathsForRole, roleHome, sectionPath } from '@/constants/routePaths';
import { findUserById } from '@/constants/mockUsers';

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

const USER_FOR_ROLE = Object.fromEntries(
  ['USR-0001', 'USR-0002', 'USR-0003', 'USR-0004', 'USR-0005', 'USR-0007', 'USR-0008']
    .map(findUserById)
    .map((user) => [user.role, user]),
);

const ALL_ROLES = Object.values(ROLES);

function renderAt(path) {
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
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('no role can open another role dashboard by URL', () => {
  const pairs = ALL_ROLES.flatMap((role) =>
    ALL_ROLES.filter((other) => other !== role).map((other) => [
      `${role} → ${roleHome(other)}`,
      role,
      other,
    ]),
  );

  it.each(pairs)('%s is refused', (_label, role, other) => {
    useAuthStore.setState({ currentUser: USER_FOR_ROLE[role] });
    renderAt(roleHome(other));

    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
});

describe('the route gate agrees with the grant table', () => {
  it('allows every granted route for its own role', () => {
    for (const { role, path } of ROLE_ROUTES) {
      const concrete = path.replace(':queryId', 'QRY-2026-00001');
      expect(isRouteAllowedForRole(role, concrete), `${role} → ${concrete}`).toBe(true);
    }
  });

  it('refuses every route belonging to a different role', () => {
    for (const { role, path } of ROLE_ROUTES) {
      const concrete = path.replace(':queryId', 'QRY-2026-00001');
      for (const other of ALL_ROLES.filter((r) => r !== role)) {
        expect(isRouteAllowedForRole(other, concrete), `${other} → ${concrete}`).toBe(false);
      }
    }
  });

  it('refuses a section the role was never granted, even under its own slug', () => {
    expect(isRouteAllowedForRole(ROLES.INQUIRER, '/inquirer/dispatch')).toBe(false);
    expect(isRouteAllowedForRole(ROLES.REVIEWER, '/reviewer/approvals')).toBe(false);
    expect(isRouteAllowedForRole(ROLES.FRONT_OFFICE, '/front-officer/drafting')).toBe(false);
  });

  it('does not treat a list path as its own detail path, or vice versa', () => {
    expect(isRouteAllowedForRole(ROLES.REVIEWER, '/reviewer/reviews')).toBe(true);
    expect(isRouteAllowedForRole(ROLES.REVIEWER, '/reviewer/reviews/QRY-2026-00001')).toBe(true);
    expect(isRouteAllowedForRole(ROLES.REVIEWER, '/reviewer/reviews/QRY-1/edit')).toBe(false);
  });

  it('refuses an unknown role and an unknown path', () => {
    expect(isRouteAllowedForRole('DIRECTOR', '/reviewer/reviews')).toBe(false);
    expect(isRouteAllowedForRole(ROLES.REVIEWER, '/nonsense')).toBe(false);
  });
});

describe('navigation is derived from the grants, never a second list', () => {
  it.each(ALL_ROLES)('every %s sidebar item is a route that role may open', (role) => {
    const items = navItemsForRole(role);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(isRouteAllowedForRole(role, item.path), `${role} → ${item.path}`).toBe(true);
    }
  });

  it('offers the inquirer only their own two pages', () => {
    expect(navItemsForRole(ROLES.INQUIRER).map((i) => i.label)).toEqual([
      'Dashboard',
      'Raise Enquiry',
    ]);
  });

  it('does not offer Notifications to a role that was never granted it', () => {
    expect(roleHasSection(ROLES.INQUIRER, SECTION.NOTIFICATIONS)).toBe(false);
    expect(navItemsForRole(ROLES.INQUIRER).map((i) => i.section)).not.toContain(
      SECTION.NOTIFICATIONS,
    );
  });

  it('offers Raise Enquiry only to the inquirer and Super Admin', () => {
    const offered = ALL_ROLES.filter((role) =>
      navItemsForRole(role).some((i) => i.section === SECTION.COMPOSE),
    );
    expect(offered.sort()).toEqual([ROLES.INQUIRER, ROLES.SUPER_ADMIN].sort());
  });

  it('unknown or missing role gets no navigation at all', () => {
    expect(navItemsForRole(undefined)).toEqual([]);
    expect(navItemsForRole('DIRECTOR')).toEqual([]);
  });
});

describe('path resolution', () => {
  it('namespaces every role under its own slug', () => {
    for (const role of ALL_ROLES) {
      expect(roleHome(role)).toBe(`/${ROLE_SLUG[role]}/dashboard`);
    }
  });

  it('matches the requested URL shape', () => {
    expect(sectionPath(ROLES.FRONT_OFFICE, SECTION.QUERY_DETAIL)).toBe(
      '/front-officer/queries/:queryId',
    );
    expect(sectionPath(ROLES.SUPER_ADMIN, SECTION.USERS)).toBe('/super-admin/users');
    expect(sectionPath(ROLES.INQUIRER, SECTION.COMPOSE)).toBe('/inquirer/compose');
  });

  it('exposes only granted sections, so an ungranted link cannot be built', () => {
    const paths = pathsForRole(ROLES.INQUIRER);
    expect(paths.COMPOSE).toBe('/inquirer/compose');
    expect(paths[SECTION.DISPATCH]).toBeUndefined();
  });

  it('returns a stable object per role — an unstable one would loop the store', () => {
    expect(pathsForRole(ROLES.REVIEWER)).toBe(pathsForRole(ROLES.REVIEWER));
    expect(pathsForRole(undefined)).toBe(pathsForRole(null));
  });

  it('every granted section has a segment defined', () => {
    for (const role of ALL_ROLES) {
      for (const section of sectionsForRole(role)) {
        expect(SECTIONS[section]?.segment, `${role} → ${section}`).toBeTruthy();
      }
    }
  });
});

describe('workflow actions respect the role namespace', () => {
  it('does not offer a stage link a role cannot open', () => {
    const paths = pathsForRole(ROLES.FRONT_OFFICE);
    expect(paths[SECTION.DRAFTING_DETAIL]).toBeUndefined();
    expect(paths[SECTION.REVIEW_DETAIL]).toBeUndefined();
    expect(paths[SECTION.DISPATCH_DETAIL]).toBe('/front-officer/dispatch/:queryId');
  });
});
