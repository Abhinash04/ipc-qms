import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { sectionsForRole } from '@/constants/permissions';
import { SECTION } from '@/constants/routeSections';

vi.mock('@/services/api/adminService');
vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy', service: 'qms-backend' }),
}));
vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({ transport: 'mock', ipcQueryEmail: 'ipc@test.invalid', participants: [] }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

import * as adminService from '@/services/api/adminService';

const ADMIN = findUserById('USR-0007');
const SUPER_ADMIN = findUserById('USR-0008');
const FRONT_OFFICE = findUserById('USR-0002');

const EVENTS = [
  {
    timestamp: '2026-09-10T09:42:00.000Z',
    actorType: 'human',
    actorId: 'USR-0002',
    actorRole: 'FRONT_OFFICE',
    action: 'EMAIL_FORWARDED',
    result: 'success',
    queryId: 'QRY-2026-00421',
    details: { transport: 'mock', recipients: 1, attachments: 2 },
  },
  {
    timestamp: '2026-09-10T09:40:00.000Z',
    actorType: 'agent',
    actorRole: 'FRONT_OFFICE',
    action: 'AI_SUMMARY_GENERATED',
    result: 'success',
    queryId: 'QRY-2026-00421',
    aiMetadata: { latencyMs: 812, fallback: true, aiGenerated: false },
  },
  {
    timestamp: '2026-09-10T09:38:00.000Z',
    actorType: 'human',
    actorRole: 'INQUIRER',
    action: 'AUTHORIZATION_DENIED',
    result: 'denied',
    queryId: null,
    details: { method: 'DELETE', path: '/api/v1/mailbox', reason: 'role INQUIRER not permitted' },
  },
];

const SUMMARY = {
  overall: {
    total: 3,
    byAction: { EMAIL_FORWARDED: 1, AI_SUMMARY_GENERATED: 1, AUTHORIZATION_DENIED: 1 },
    byResult: { success: 2, denied: 1 },
    byActorType: { human: 2, agent: 1 },
    backend: 'mongo',
    durable: true,
  },
  today: {
    total: 3,
    byAction: { EMAIL_FORWARDED: 1, AI_SUMMARY_GENERATED: 1, AUTHORIZATION_DENIED: 1 },
    byResult: { success: 2, denied: 1 },
    byActorType: { human: 2, agent: 1 },
    backend: 'mongo',
    durable: true,
  },
};

function renderAs(user, path) {
  useAuthStore.setState({ currentUser: user, authReady: true });
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
  vi.mocked(adminService.fetchAuditSummary).mockResolvedValue(SUMMARY);
  vi.mocked(adminService.fetchAuditEvents).mockResolvedValue({ events: EVENTS, count: EVENTS.length, durable: true });
  vi.mocked(adminService.fetchAuditForQuery).mockResolvedValue({ queryId: 'QRY-1', events: [], count: 0 });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('Administration is one console, gated by section grants', () => {
  it.each([
    ['Audit Trail', '/admin/administration/activity'],
    ['Email Activity', '/admin/administration/email'],
    ['AI Agent', '/admin/administration/ai'],
  ])('ADMIN can open %s', async (heading, path) => {
    renderAs(ADMIN, path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  // Routes exist only for a role's granted sections, so an ADMIN visiting
  // /admin/administration/settings matches no route at all. The reachable
  // way to attempt it is the Super Admin URL, which is what a curious user
  // would actually paste — and there ProtectedRoute refuses.
  it('ADMIN is refused System Settings — the one elevated area', async () => {
    renderAs(ADMIN, '/super-admin/administration/settings');

    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'System Settings' })).not.toBeInTheDocument();
  });

  it('SUPER_ADMIN can open System Settings', async () => {
    renderAs(SUPER_ADMIN, '/super-admin/administration/settings');
    expect(await screen.findByRole('heading', { name: 'System Settings' })).toBeInTheDocument();
  });

  it('an operational role cannot reach the audit trail', async () => {
    renderAs(FRONT_OFFICE, '/admin/administration/activity');

    expect(await screen.findByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Trail' })).not.toBeInTheDocument();
  });

  it('the permission tables agree: ADMIN_SETTINGS is Super Admin only', () => {
    expect(sectionsForRole(ROLES.SUPER_ADMIN)).toContain(SECTION.ADMIN_SETTINGS);
    expect(sectionsForRole(ROLES.ADMIN)).not.toContain(SECTION.ADMIN_SETTINGS);

    // Everything else in the console is shared — the console is not forked.
    for (const section of [SECTION.ADMINISTRATION, SECTION.ADMIN_ACTIVITY, SECTION.ADMIN_EMAIL, SECTION.ADMIN_AI]) {
      expect(sectionsForRole(ROLES.ADMIN)).toContain(section);
      expect(sectionsForRole(ROLES.SUPER_ADMIN)).toContain(section);
    }
  });
});

describe('the dashboard shows server-recorded figures, not invented ones', () => {
  it('renders KPI values taken from the audit summary', async () => {
    renderAs(ADMIN, '/admin/administration');

    expect(await screen.findByText('System events today')).toBeInTheDocument();
    // 1 EMAIL_FORWARDED from byAction, and 1 denied from byResult.
    expect(screen.getByText('Email actions today')).toBeInTheDocument();
    expect(screen.getByText('Failures & denials today')).toBeInTheDocument();
    expect(adminService.fetchAuditSummary).toHaveBeenCalled();
  });

  it('lists real recent activity from the trail', async () => {
    renderAs(ADMIN, '/admin/administration');

    expect(await screen.findByText('Email forwarded')).toBeInTheDocument();
    expect(screen.getByText('Ai summary generated')).toBeInTheDocument();
  });

  it('labels the case figures as system-wide, which is what they now are', async () => {
    renderAs(ADMIN, '/admin/administration');

    // This label read "This browser only — cases are not yet stored
    // server-side" for as long as cases lived in each user's IndexedDB. They
    // are in MongoDB now, and an admin console that understates its own scope
    // is as misleading as one that overstates it.
    expect(
      await screen.findByText(/System-wide — cases are stored server-side/),
    ).toBeInTheDocument();
  });

  it('says so plainly when the audit API cannot be reached, instead of showing zeroes', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockRejectedValue(new Error('Network Error'));
    renderAs(ADMIN, '/admin/administration');

    expect(await screen.findByRole('alert')).toHaveTextContent('System activity unavailable');
  });

  it('warns when the audit store is not durable', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockResolvedValue({
      ...SUMMARY,
      overall: { ...SUMMARY.overall, backend: 'in-memory', durable: false },
    });
    renderAs(ADMIN, '/admin/administration');

    expect(await screen.findByText(/in-memory — not durable/)).toBeInTheDocument();
  });
});

describe('the audit trail table', () => {
  it('renders one row per event with actor, action and result', async () => {
    renderAs(ADMIN, '/admin/administration/activity');

    // Wait on the case id: it appears only in a rendered row, whereas the
    // event names also exist as filter options and would resolve immediately.
    const caseLinks = await screen.findAllByRole('button', { name: 'QRY-2026-00421' });
    expect(caseLinks).toHaveLength(2);

    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(EVENTS.length);
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('expands a row to show the recorded detail', async () => {
    renderAs(ADMIN, '/admin/administration/activity');
    await screen.findAllByRole('button', { name: 'QRY-2026-00421' });

    fireEvent.click(screen.getByRole('button', { name: /details for Email forwarded/i }));

    expect(await screen.findByText(/attachments:/)).toBeInTheDocument();
  });

  it('sends the chosen filters to the server rather than filtering locally', async () => {
    renderAs(ADMIN, '/admin/administration/activity');
    await screen.findByText('Email forwarded');

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'failure' } });

    await waitFor(() => {
      expect(adminService.fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
    });
  });

  it('reports an unreachable API rather than an empty table', async () => {
    vi.mocked(adminService.fetchAuditEvents).mockRejectedValue(new Error('Network Error'));
    renderAs(ADMIN, '/admin/administration/activity');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit trail');
  });
});

describe('AI monitoring surfaces the fallback, which is otherwise silent', () => {
  it('separates model-answered calls from fallbacks', async () => {
    renderAs(ADMIN, '/admin/administration/ai');

    // Awaits the note itself — the donut title renders before the data lands.
    expect(await screen.findByText(/used deterministic fallback text/)).toBeInTheDocument();
    expect(screen.getByText('Answered by the model vs fallback')).toBeInTheDocument();
  });

  it('shows the recorded latency', async () => {
    renderAs(ADMIN, '/admin/administration/ai');
    expect(await screen.findByText(/812 ms/)).toBeInTheDocument();
  });

  it('never renders a prompt or generated content', async () => {
    renderAs(ADMIN, '/admin/administration/ai');
    await screen.findByText(/used deterministic fallback text/);

    expect(screen.queryByText(/prompt/i)).not.toBeInTheDocument();
  });
});

describe('the roles matrix is generated from the live permission tables', () => {
  it('renders both matrices and states that the console is shared', async () => {
    renderAs(ADMIN, '/admin/roles');

    expect(await screen.findByRole('heading', { name: 'Roles & Permissions' })).toBeInTheDocument();
    expect(screen.getByText('Page access')).toBeInTheDocument();
    expect(screen.getByText('Workflow actions')).toBeInTheDocument();
    expect(screen.getByText(/Administration is one interface/)).toBeInTheDocument();
  });

  it('reflects that ADMIN holds no workflow actions', async () => {
    renderAs(ADMIN, '/admin/roles');

    const actions = (await screen.findByText('Workflow actions')).closest('section');
    const forwardRow = within(actions).getByText('Forward').closest('tr');
    // Column order is SUPER_ADMIN, ADMIN, ... — Super Admin granted, Admin not.
    const cells = within(forwardRow).getAllByLabelText(/granted/);
    expect(cells[0]).toHaveAttribute('aria-label', 'granted');
    expect(cells[1]).toHaveAttribute('aria-label', 'not granted');
  });
});
