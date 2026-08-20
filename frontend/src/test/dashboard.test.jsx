import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigateSpy,
}));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById, MOCK_USERS } from '@/constants/mockUsers';
import { WORKFLOW_STATE, AUDIT_EVENT, AUDIT_EVENT_LABELS } from '@/constants/statusEnums';
import { ROLES } from '@/constants/roles';

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
  // Walk up from the label until the subtree also holds the tile's number, so
  // the helper survives markup changes inside the card.
  let node = screen.getAllByText(label)[0];
  for (let i = 0; i < 8 && node.parentElement; i += 1) {
    if (/\d/.test(node.textContent)) return node;
    node = node.parentElement;
  }
  return node;
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
  navigateSpy.mockClear();
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
    expect(tile('Closed')).toHaveTextContent('+1 in 30 days');
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
    expect(screen.getByText(/Nothing waiting on you/)).toBeInTheDocument();
  });
});

// --- the rest of the dashboard ---

/** Close `queryId` and record the audit event the panels read. */
function close(queryId, at = new Date()) {
  useWorkflowStore.setState((s) => ({
    queries: s.queries.map((q) =>
      q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.CLOSED } : q,
    ),
    auditEvents: [
      ...s.auditEvents,
      {
        auditId: `AUD-CLOSE-${queryId}`,
        queryId,
        event: AUDIT_EVENT.QUERY_CLOSED,
        actor: 'System',
        at: at.toISOString(),
      },
    ],
  }));
}

describe('the dashboard invents nothing', () => {
  it('shows none of the hard-coded rows it used to ship with', () => {
    renderDashboard();

    for (const invented of [
      'Q-2034', 'Q-2031', 'Q-2028', 'Q-2041', 'Q-2038', 'Q-2035',
      'Staff access request for new ERP module',
      'Compliance report Q2 amendment required',
      'Vendor invoice mismatch — July batch',
      'Bhumika added a comment on Q-2038',
      '91%', '87%', '72%', 'Tech Ops', 'Legal', 'Finance',
    ]) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('shows empty states rather than filler on a fresh store', () => {
    renderDashboard();
    expect(screen.getByText('Nothing closed yet')).toBeInTheDocument();
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });

  it('reports no resolution rate for a period with no enquiries', () => {
    renderDashboard();
    expect(screen.getAllByText('No data')).toHaveLength(3);
  });
});

describe('Recently closed reads the audit trail', () => {
  it('lists a real closed query by id and subject', () => {
    const queryId = ingest(1);
    close(queryId);
    renderDashboard();

    expect(screen.queryByText('Nothing closed yet')).toBeNull();
    expect(screen.getAllByText('Dashboard fixture 1').length).toBeGreaterThan(0);
    // The id shows in Recently closed and again in the activity feed.
    expect(screen.getAllByText(new RegExp(queryId)).length).toBeGreaterThan(0);
  });

  it('does not list a query that is still open', () => {
    ingest(1);
    renderDashboard();
    expect(screen.getByText('Nothing closed yet')).toBeInTheDocument();
  });
});

describe('Resolution rate is computed, not asserted', () => {
  it('reports the share of received enquiries that are closed', () => {
    const a = ingest(1);
    ingest(2);
    close(a);

    renderDashboard();
    // Two received this week, one of them closed.
    // Both 'this month' and 'this week' cover the same two enquiries.
    expect(screen.getAllByText('1 of 2 closed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
  });
});

describe('each resolution-rate window is computed separately', () => {
  /** Record a receipt at `daysAgo`, so the windows can disagree. */
  function received(queryId, daysAgo) {
    const at = new Date();
    at.setDate(at.getDate() - daysAgo);
    useWorkflowStore.setState((st) => ({
      auditEvents: [
        ...st.auditEvents,
        {
          auditId: `AUD-RCV-${queryId}-${daysAgo}`,
          queryId,
          event: AUDIT_EVENT.QUERY_RECEIVED,
          actor: 'System',
          at: at.toISOString(),
        },
      ],
    }));
  }

  it('does not report the same figure for every period', () => {
    // One enquiry ten days ago and closed, one today and still open. "This
    // week" and "This month" therefore cannot share a percentage — they did,
    // because all three rows rendered one all-time value.
    const older = ingest(1);
    const newer = ingest(2);
    useWorkflowStore.setState((st) => ({
      auditEvents: st.auditEvents.filter((e) => e.event !== AUDIT_EVENT.QUERY_RECEIVED),
    }));
    received(older, 10);
    received(newer, 0);
    close(older, new Date());

    renderDashboard();

    const percentages = screen
      .getAllByText(/^\d+%$|^No data$/)
      .map((el) => el.textContent);

    expect(percentages.length).toBeGreaterThanOrEqual(3);
    expect(new Set(percentages).size).toBeGreaterThan(1);
  });
});

describe('Activity feed shows real transitions in words', () => {
  it('renders the audit trail newest first, with labels not enums', () => {
    ingest(1);
    renderDashboard();

    expect(screen.queryByText('No activity yet')).toBeNull();
    expect(screen.getByText(/Enquiry received/)).toBeInTheDocument();
    // The raw enum must never reach the screen.
    expect(screen.queryByText(/QUERY_RECEIVED/)).toBeNull();
  });

  it('has a label for every audit event, so none can render blank', () => {
    for (const event of Object.values(AUDIT_EVENT)) {
      expect(AUDIT_EVENT_LABELS[event], `no label for ${event}`).toBeTruthy();
    }
  });
});

describe('an Inquirer sees only their own queries', () => {
  const INQUIRER = MOCK_USERS.find((u) => u.role === ROLES.INQUIRER);

  it('shows the inquirer their own closed query', () => {
    const queryId = ingest(1);          // ingested from the inquirer's address
    close(queryId);
    useAuthStore.setState({ currentUser: INQUIRER });

    renderDashboard();
    expect(screen.getAllByText('Dashboard fixture 1').length).toBeGreaterThan(0);
  });

  it("hides another inquirer's query from them", () => {
    const queryId = useWorkflowStore.getState().ingestEmail(
      {
        mailboxMessageId: 'MSG-OTHER',
        to: 'ipc-query-mock@example.com',
        from: 'Someone Else <someone.else@example.com>',
        subject: 'Not your enquiry',
        body: 'Body.',
        receivedAt: new Date().toISOString(),
      },
      async () => null,
    ).queryId;
    close(queryId);
    useAuthStore.setState({ currentUser: INQUIRER });

    renderDashboard();
    expect(screen.queryByText('Not your enquiry')).toBeNull();
    expect(screen.getByText('Nothing closed yet')).toBeInTheDocument();
  });

  it('offers no "View all" link, having no queries list', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    renderDashboard();
    expect(screen.queryByText('View all')).toBeNull();
  });
});

describe("New Query is the Inquirer's alone", () => {
  const INQUIRER = MOCK_USERS.find((u) => u.role === ROLES.INQUIRER);

  it('renders for the Inquirer and points at their compose page', () => {
    useAuthStore.setState({ currentUser: INQUIRER });
    renderDashboard();

    const button = screen.getByRole('button', { name: /New Query/ });
    fireEvent.click(button);
    expect(navigateSpy).toHaveBeenCalledWith('/inquirer/compose');
  });

  it.each(
    [ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL,
     ROLES.REVIEWER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  )('is hidden for %s', (role) => {
    useAuthStore.setState({ currentUser: MOCK_USERS.find((u) => u.role === role) });
    renderDashboard();
    expect(screen.queryByRole('button', { name: /New Query/ })).toBeNull();
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
