import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { ROLE_ROUTES } from '@/routes/roleRoutes';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { buildPath } from '@/constants/routePaths';
import { findUserById } from '@/constants/mockUsers';

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({
    transport: 'mock',
    ipcQueryEmail: 'ipc-query-mock@example.com',
    ipcReplyFrom: { email: 'arnd-ipc-mock@example.com', name: 'AR&D Division' },
    inquirer: { email: 'abhinash.pritiraj@gmail.com', name: 'Abhinash Pritiraj' },
  }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendEnquiry: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-1' }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

let WALKTHROUGH_ID;
let ADVANCED_ID;

const USER_FOR_ROLE = Object.fromEntries(
  ['USR-0001', 'USR-0002', 'USR-0003', 'USR-0004', 'USR-0005', 'USR-0007', 'USR-0008']
    .map(findUserById)
    .map((user) => [user.role, user]),
);

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
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();

  const store = useWorkflowStore.getState();
  WALKTHROUGH_ID = store.ingestEmail({
    mailboxMessageId: 'MSG-00001',
    to: 'ipc-query-mock@example.com',
    from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
    subject: 'Clarification on monograph revision timelines',
    body: 'Please confirm the revised submission window.',
    receivedAt: '2026-08-17T09:00:00.000Z',
  }).queryId;

  ADVANCED_ID = store.ingestEmail({
    mailboxMessageId: 'MSG-00002',
    to: 'ipc-query-mock@example.com',
    from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
    subject: 'Query on impurity threshold reporting',
    body: 'Seeking guidance on reporting thresholds.',
    receivedAt: '2026-08-17T10:00:00.000Z',
  }).queryId;
});

beforeEach(() => {
  useAuthStore.setState({ currentUser: USER_FOR_ROLE.SUPER_ADMIN });
});

describe('store hydration', () => {
  it('hydrates, and holds only the queries created by ingesting email', () => {
    expect(useWorkflowStore.getState().hydrated).toBe(true);
    expect(useWorkflowStore.getState().queries).toHaveLength(2);
  });

  it('has the two ingested queries', () => {
    const ids = useWorkflowStore.getState().queries.map((q) => q.queryId);
    expect(ids).toContain(WALKTHROUGH_ID);
    expect(ids).toContain(ADVANCED_ID);
    expect(ids).toEqual(['QRY-2026-00001', 'QRY-2026-00002']);
  });
});

describe('every generated route renders for the role that owns it', () => {
  const cases = ROLE_ROUTES.map(({ role, path }) => [`${role} → ${path}`, role, path]);

  it.each(cases)('%s', (_name, role, path) => {
    useAuthStore.setState({ currentUser: USER_FOR_ROLE[role] });
    const resolved = path.includes(':queryId')
      ? buildPath(path, { queryId: WALKTHROUGH_ID })
      : path;

    expect(() => renderAt(resolved)).not.toThrow();
    expect(screen.queryByText('Access restricted')).not.toBeInTheDocument();
  });
});

describe('detail routes render real content', () => {
  it('renders the originally-crashing route with real content', () => {
    renderAt(`/super-admin/queries/${ADVANCED_ID}`);
    expect(screen.getAllByText(ADVANCED_ID).length).toBeGreaterThan(0);
  });

  it('shows the audit history on the case workspace', () => {
    renderAt(`/super-admin/queries/${WALKTHROUGH_ID}`);
    expect(screen.getByText('Audit history')).toBeInTheDocument();
  });

  it('renders every stage detail page for the second case too', () => {
    for (const stage of ['queries', 'assignments', 'drafting', 'reviews', 'approvals', 'dispatch']) {
      expect(() => renderAt(`/super-admin/${stage}/${ADVANCED_ID}`)).not.toThrow();
    }
  });
});

describe('module resolution', () => {
  it('no source file imports the non-existent @/lib/utils', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'test') walk(full);
        } else if (/\.jsx?$/.test(entry) && readFileSync(full, 'utf8').includes('@/lib/utils')) {
          offenders.push(full);
        }
      }
    };
    walk('src');

    expect(offenders).toEqual([]);
  });
});

describe('auth route', () => {
  it('renders /login without errors', () => {
    useAuthStore.setState({ currentUser: null });
    expect(() => renderAt('/login')).not.toThrow();
  });
});

