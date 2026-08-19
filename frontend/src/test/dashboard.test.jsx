import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

/**
 * The dashboard KPI tiles.
 *
 * These exist because the tiles shipped with invented trend lines — '+3 this
 * week', '3 overdue', '+12 this month' — rendered beside a real count, so a
 * fresh install displayed "0 ↑ +12 this month". Every number on this page must
 * trace back to the query data or the audit trail.
 */

const OIC = findUserById('USR-0003');
const FRONT_OFFICE = findUserById('USR-0002');

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The trend arrow renders as its own text node, so the trend line is split
 * across elements — assert on the tile as a whole instead of the text.
 *
 * A label like "Closed" also appears on the status badges in the queue table
 * below, so this takes the first match: the KPI grid renders before the table.
 */
function tile(label) {
  return screen.getAllByText(label)[0].closest('div').parentElement;
}

/** An enquiry arriving is the only way a query comes into existence. */
function ingest(n) {
  return useWorkflowStore.getState().ingestEmail(
    {
      mailboxMessageId: `MSG-DASH-${n}`,
      to: 'ipc-query-mock@example.com',
      from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
      subject: `Dashboard fixture ${n}`,
      body: 'Body text.',
      receivedAt: new Date().toISOString(),
    },
    async () => null,
  ).queryId;
}

beforeEach(async () => {
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: OIC });
});

describe('KPI tiles show no trend when nothing has happened', () => {
  it('renders zeroes and invents no trend on an empty store', () => {
    renderDashboard();

    expect(useWorkflowStore.getState().queries).toHaveLength(0);

    // The exact strings that used to be hard-coded.
    for (const invented of ['+3 this week', '2 pending review', '3 overdue', '+12 this month']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
    // Nor any trend at all — there is no activity to describe.
    expect(screen.queryByText(/this week|this month|in 30 days|awaiting your decision/)).toBeNull();
  });

  it('shows no "closed" trend while nothing has been closed', () => {
    ingest(1);
    renderDashboard();

    expect(screen.queryByText(/closed in 30 days/)).toBeNull();
  });
});

describe('KPI tiles count the real data', () => {
  it('counts received enquiries and reports them as this week', () => {
    ingest(1);
    ingest(2);
    renderDashboard();

    expect(tile('In drafting')).toHaveTextContent('+2 received this week');
  });

  it('moves the closed count and its trend together when a query closes', async () => {
    const queryId = ingest(1);

    // Close it directly on the record; the tile reads state, not a fixture.
    useWorkflowStore.setState((s) => ({
      queries: s.queries.map((q) =>
        q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.CLOSED } : q,
      ),
      auditEvents: [
        ...s.auditEvents,
        {
          auditId: 'AUD-DASH-1',
          queryId,
          event: 'QUERY_CLOSED',
          actorLabel: 'System',
          at: new Date().toISOString(),
        },
      ],
    }));

    renderDashboard();
    expect(tile('Closed')).toHaveTextContent('+1 closed in 30 days');
    expect(tile('Closed')).toHaveTextContent('1');
  });

  it('ignores audit events that fall outside the window', () => {
    const queryId = ingest(1);
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 90);

    useWorkflowStore.setState((s) => ({
      auditEvents: [
        ...s.auditEvents,
        {
          auditId: 'AUD-DASH-OLD',
          queryId,
          event: 'QUERY_CLOSED',
          actorLabel: 'System',
          at: longAgo.toISOString(),
        },
      ],
    }));

    renderDashboard();
    expect(screen.queryByText(/closed in 30 days/)).toBeNull();
  });
});

describe('KPI tiles are filtered to the signed-in user', () => {
  /** Assign the one query to `userId`, then read the tile as that user. */
  function assignTo(userId, viewer) {
    const queryId = ingest(1);
    useWorkflowStore.setState((s) => ({
      queries: s.queries.map((q) =>
        q.queryId === queryId ? { ...q, currentAssigneeId: userId } : q,
      ),
    }));
    useAuthStore.setState({ currentUser: viewer });
    renderDashboard();
  }

  it('counts a query assigned to the signed-in user', () => {
    assignTo(OIC.id, OIC);
    expect(tile('Assigned to you')).toHaveTextContent('1');
  });

  it('does not count it for a different user', () => {
    assignTo(OIC.id, FRONT_OFFICE);
    expect(tile('Assigned to you')).toHaveTextContent('0');
  });
});

describe('no mock query data reaches the dashboard', () => {
  it('starts empty — nothing is seeded', async () => {
    await useWorkflowStore.getState().resetDemo();

    const state = useWorkflowStore.getState();
    expect(state.queries).toEqual([]);
    expect(state.workflowSteps).toEqual([]);
    expect(state.auditEvents).toEqual([]);

    renderDashboard();
    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument();
  });
});

// The Gemma client has no backend under test; the store takes it as an
// injected parameter, and `ingest` above passes a stub.
vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendEnquiry: vi.fn().mockResolvedValue({}),
  sendAcknowledgement: vi.fn().mockResolvedValue({}),
}));
