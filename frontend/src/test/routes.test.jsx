import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLES } from '@/constants/roles';

/**
 * Render smoke tests for every route.
 *
 * These exist because a `curl` status check passes even when React crashes on
 * mount — the SPA shell returns 200 regardless. Mounting the real component
 * tree against the real store is the only thing that catches render-time
 * failures such as unstable Zustand selectors (see hooks/useQueryCase.js).
 *
 * The console-error trap in test/setup.js does the heavy lifting: React logs
 * "The result of getSnapshot should be cached" before the render-depth limit
 * throws, so noise-free rendering is the actual assertion.
 */

// The seeded walkthrough case plus a background case at a later stage — they
// exercise different workflow states and different action-card branches.
const WALKTHROUGH_ID = 'QRY-2026-00427';
const ADVANCED_ID = 'QRY-2026-00431';

function renderAt(path) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  // Seed IndexedDB once so pages have real data to render.
  await useWorkflowStore.getState().hydrate();
});

beforeEach(() => {
  // Super Admin sees every route and every action branch.
  const superAdmin = { id: 'USR-0008', name: 'System Administrator', role: ROLES.SUPER_ADMIN, email: 'admin@ipc.example' };
  useAuthStore.setState({ currentUser: superAdmin });
});

describe('store hydration', () => {
  it('seeds queries into the store', () => {
    expect(useWorkflowStore.getState().queries.length).toBeGreaterThan(1);
    expect(useWorkflowStore.getState().hydrated).toBe(true);
  });

  it('has both the walkthrough and the advanced query', () => {
    const ids = useWorkflowStore.getState().queries.map((q) => q.queryId);
    expect(ids).toContain(WALKTHROUGH_ID);
    expect(ids).toContain(ADVANCED_ID);
  });
});

describe('list routes render', () => {
  const listRoutes = [
    '/dashboard',
    '/queries',
    '/my-work',
    '/assignments',
    '/drafting',
    '/reviews',
    '/approvals',
    '/dispatch',
    '/notifications',
    '/reports',
    '/admin',
    '/admin/users',
    '/admin/roles',
    '/admin/divisions',
    '/admin/workflows',
    '/admin/categories',
  ];

  it.each(listRoutes)('renders %s without errors', (path) => {
    expect(() => renderAt(path)).not.toThrow();
  });
});

describe('detail routes render', () => {
  // Every route that calls useQueryCase() — the hook that caused the
  // infinite-render crash. Both query IDs, since action availability differs
  // by workflow state.
  const detailRoutes = ['/queries', '/assignments', '/drafting', '/reviews', '/approvals', '/dispatch'];
  const cases = detailRoutes.flatMap((base) => [
    [`${base}/${WALKTHROUGH_ID}`],
    [`${base}/${ADVANCED_ID}`],
  ]);

  it.each(cases)('renders %s without errors', (path) => {
    expect(() => renderAt(path)).not.toThrow();
  });

  it('renders the originally-crashing route with real content', () => {
    renderAt(`/queries/${ADVANCED_ID}`);
    // Query id appears in the breadcrumb and the case summary bar.
    expect(screen.getAllByText(ADVANCED_ID).length).toBeGreaterThan(0);
  });

  it('shows the audit history on the case workspace', () => {
    renderAt(`/queries/${WALKTHROUGH_ID}`);
    expect(screen.getByText('Audit history')).toBeInTheDocument();
  });
});

describe('auth route', () => {
  it('renders /login without errors', () => {
    expect(() => renderAt('/login')).not.toThrow();
  });
});
