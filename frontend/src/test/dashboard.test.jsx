import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById, MOCK_USERS } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { deriveBusinessStatus } from '@/constants/workflowRules';
import { bucketsForRole } from '@/constants/queryBuckets';
import { ROLES } from '@/constants/roles';

vi.mock('@/services/api/mailboxService', () => ({
  fetchEmailConfig: vi.fn().mockResolvedValue({}),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),  sendAcknowledgement: vi.fn().mockResolvedValue({}),
}));

import { EXTERNAL_INQUIRER } from '@/test/externalInquirer';
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const OTHER_OFFICIAL = MOCK_USERS.find(
  (u) => u.role === ROLES.ASSIGNED_OFFICIAL && u.id !== OFFICIAL.id,
);
const REVIEWER = findUserById('USR-0005');
const OTHER_REVIEWER = MOCK_USERS.find(
  (u) => u.role === ROLES.REVIEWER && u.id !== REVIEWER.id,
);

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

function tile(label) {
  return screen
    .getAllByText(label)
    .find((el) => el.matches('[data-slot="stat-label"]'))
    .closest('.bento-card');
}

function listPanel() {
  const heading = screen.getAllByRole('heading', { level: 2 })[0];
  return heading.closest('.bento-card');
}

function visibleQueryIds() {
  return within(listPanel())
    .queryAllByRole('link')
    .map((a) => a.getAttribute('href')?.split('/').pop())
    .filter(Boolean);
}

function tileCount(label) {
  const el = tile(label).querySelector('[data-slot="stat-value"]');
  return Number(el.textContent.trim());
}

function seed(queries) {
  useWorkflowStore.setState({
    queries: queries.map((q) => ({
      priority: 'NORMAL',
      createdAt: '2026-08-20T09:00:00.000Z',
      inquirer: { id: null, email: EXTERNAL_INQUIRER.email, name: EXTERNAL_INQUIRER.name },
      currentAssigneeId: null,
      currentWorkflowStepId: null,
      ...q,
      businessStatus: deriveBusinessStatus(q.workflowState),
    })),
  });
}

beforeEach(async () => {
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('a KPI number always equals the rows behind it', () => {
  const CASES = [
    [ROLES.FRONT_OFFICE, FRONT_OFFICE],
    [ROLES.OFFICER_IN_CHARGE, OIC],
    [ROLES.ASSIGNED_OFFICIAL, OFFICIAL],
    [ROLES.REVIEWER, REVIEWER],
  ];

  it.each(CASES)('%s', (role, user) => {
    seed(
      Object.values(WORKFLOW_STATE).map((state) => ({
        queryId: `QRY-${state}`,
        subject: `Case ${state}`,
        workflowState: state,
        currentAssigneeId: OFFICIAL.id,
        currentWorkflowStepId: `STP-${state}`,
      })),
    );
    useWorkflowStore.setState({
      workflowSteps: Object.values(WORKFLOW_STATE).map((state) => ({
        stepId: `STP-${state}`,
        queryId: `QRY-${state}`,
        stepType: 'REVIEW',
        assignedUserId: REVIEWER.id,
        status: 'IN_PROGRESS',
      })),
      reviews: [
        {
          reviewId: 'REV-1',
          queryId: `QRY-${WORKFLOW_STATE.CLOSED}`,
          reviewerId: REVIEWER.id,
          decision: 'APPROVED',
        },
      ],
    });
    useAuthStore.setState({ currentUser: user });

    renderDashboard();

    for (const bucket of bucketsForRole(role)) {
      fireEvent.click(tile(bucket.label));
      const shown = tileCount(bucket.label);
      expect(
        visibleQueryIds().length,
        `${role} / ${bucket.label}: tile says ${shown}`,
      ).toBe(shown);
    }
  });
});

describe('Front Office dashboard', () => {
  it('separates incoming work from what is awaiting dispatch', () => {
    seed([
      { queryId: 'QRY-NEW', subject: 'Just arrived', workflowState: WORKFLOW_STATE.RECEIVED },
      {
        queryId: 'QRY-FWD',
        subject: 'With the OIC',
        workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
      },
      {
        queryId: 'QRY-SEND',
        subject: 'Ready to send',
        workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH,
      },
    ]);
    useAuthStore.setState({ currentUser: FRONT_OFFICE });
    renderDashboard();

    expect(tile('New / Incoming')).toHaveTextContent('1');
    expect(tile('Pending Assignment')).toHaveTextContent('1');
    expect(tile('Awaiting Dispatch')).toHaveTextContent('1');

    expect(visibleQueryIds()).toEqual(['QRY-NEW']);

    fireEvent.click(tile('Awaiting Dispatch'));
    expect(visibleQueryIds()).toEqual(['QRY-SEND']);
  });
});

describe('Officer-in-Charge dashboard', () => {
  it('surfaces the approval queue that the OIC owns', () => {
    seed([
      {
        queryId: 'QRY-ASSIGN',
        subject: 'Needs an official',
        workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
      },
      {
        queryId: 'QRY-APPROVE',
        subject: 'Needs sign-off',
        workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
      },
    ]);
    useAuthStore.setState({ currentUser: OIC });
    renderDashboard();

    expect(tile('Awaiting Assignment')).toHaveTextContent('1');
    expect(tile('Awaiting Final Approval')).toHaveTextContent('1');

    fireEvent.click(tile('Awaiting Final Approval'));
    expect(visibleQueryIds()).toEqual(['QRY-APPROVE']);
  });
});

describe('Assigned Official dashboard', () => {
  it('shows only this officials cases, split by stage', () => {
    seed([
      {
        queryId: 'QRY-MINE-DRAFT',
        subject: 'My draft',
        workflowState: WORKFLOW_STATE.DRAFTING,
        currentAssigneeId: OFFICIAL.id,
      },
      {
        queryId: 'QRY-MINE-DONE',
        subject: 'My closed case',
        workflowState: WORKFLOW_STATE.CLOSED,
        currentAssigneeId: OFFICIAL.id,
      },
      {
        queryId: 'QRY-THEIRS',
        subject: 'Someone elses',
        workflowState: WORKFLOW_STATE.DRAFTING,
        currentAssigneeId: OTHER_OFFICIAL.id,
      },
    ]);
    useAuthStore.setState({ currentUser: OFFICIAL });
    renderDashboard();

    expect(tile('Drafting')).toHaveTextContent('1');
    expect(tile('Completed')).toHaveTextContent('1');

    fireEvent.click(tile('Drafting'));
    expect(visibleQueryIds()).toEqual(['QRY-MINE-DRAFT']);

    fireEvent.click(tile('Completed'));
    expect(visibleQueryIds()).toEqual(['QRY-MINE-DONE']);

    expect(screen.queryByText('Someone elses')).toBeNull();
  });
});

describe('Reviewer dashboard', () => {
  it('shows only the level assigned to this reviewer', () => {
    seed([
      {
        queryId: 'QRY-MINE',
        subject: 'On my level',
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentWorkflowStepId: 'STP-1',
      },
      {
        queryId: 'QRY-THEIRS',
        subject: 'On their level',
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentWorkflowStepId: 'STP-2',
      },
    ]);
    useWorkflowStore.setState({
      workflowSteps: [
        { stepId: 'STP-1', queryId: 'QRY-MINE', stepType: 'REVIEW', assignedUserId: REVIEWER.id },
        {
          stepId: 'STP-2',
          queryId: 'QRY-THEIRS',
          stepType: 'REVIEW',
          assignedUserId: OTHER_REVIEWER.id,
        },
      ],
    });
    useAuthStore.setState({ currentUser: REVIEWER });
    renderDashboard();

    expect(tile('Awaiting My Review')).toHaveTextContent('1');
    expect(visibleQueryIds()).toEqual(['QRY-MINE']);
    expect(screen.queryByText('On their level')).toBeNull();
  });

  it('counts decisions this reviewer actually recorded, with rows behind them', () => {
    seed([
      {
        queryId: 'QRY-PASSED',
        subject: 'I approved this',
        workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
      },
      {
        queryId: 'QRY-SENTBACK',
        subject: 'I returned this',
        workflowState: WORKFLOW_STATE.RETURNED_FOR_REVISION,
      },
    ]);
    useWorkflowStore.setState({
      reviews: [
        {
          reviewId: 'REV-1',
          queryId: 'QRY-PASSED',
          reviewerId: REVIEWER.id,
          decision: 'APPROVED',
        },
        {
          reviewId: 'REV-2',
          queryId: 'QRY-SENTBACK',
          reviewerId: REVIEWER.id,
          decision: 'CHANGES_REQUESTED',
        },
        {
          reviewId: 'REV-3',
          queryId: 'QRY-PASSED',
          reviewerId: OTHER_REVIEWER.id,
          decision: 'APPROVED',
        },
      ],
    });
    useAuthStore.setState({ currentUser: REVIEWER });
    renderDashboard();

    expect(tile('Approved by me')).toHaveTextContent('1');
    expect(tile('Returned by me')).toHaveTextContent('1');

    fireEvent.click(tile('Returned by me'));
    expect(visibleQueryIds()).toEqual(['QRY-SENTBACK']);
  });
});

describe('Total Queries spans the whole permitted scope', () => {
  const MIXED = [
    { queryId: 'QRY-1', subject: 'New', workflowState: WORKFLOW_STATE.RECEIVED },
    { queryId: 'QRY-2', subject: 'Drafting', workflowState: WORKFLOW_STATE.DRAFTING },
    { queryId: 'QRY-3', subject: 'Under review', workflowState: WORKFLOW_STATE.UNDER_REVIEW },
    { queryId: 'QRY-4', subject: 'Closed', workflowState: WORKFLOW_STATE.CLOSED },
  ];

  it('counts every status for Front Office, not just the incoming ones', () => {
    seed(MIXED);
    useAuthStore.setState({ currentUser: FRONT_OFFICE });
    renderDashboard();

    expect(tileCount('Total Queries')).toBe(4);
    expect(tileCount('New / Incoming')).toBe(1);

    fireEvent.click(tile('Total Queries'));
    expect(visibleQueryIds().sort()).toEqual(['QRY-1', 'QRY-2', 'QRY-3', 'QRY-4']);
  });

  it('opens on the actionable queue rather than Total', () => {
    seed(MIXED);
    useAuthStore.setState({ currentUser: FRONT_OFFICE });
    renderDashboard();

    expect(tile('New / Incoming')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Total Queries')).toHaveAttribute('aria-pressed', 'false');
    expect(visibleQueryIds()).toEqual(['QRY-1']);
  });

  it('covers a reviewer case that no status tile accounts for', () => {
    seed([
      {
        queryId: 'QRY-PENDING-LEVEL',
        subject: 'Queued for me later',
        workflowState: WORKFLOW_STATE.UNDER_REVIEW,
        currentWorkflowStepId: 'STP-OTHER',
      },
    ]);
    useWorkflowStore.setState({
      workflowSteps: [
        {
          stepId: 'STP-OTHER',
          queryId: 'QRY-PENDING-LEVEL',
          stepType: 'REVIEW',
          assignedUserId: OTHER_REVIEWER.id,
        },
        {
          stepId: 'STP-MINE',
          queryId: 'QRY-PENDING-LEVEL',
          stepType: 'REVIEW',
          assignedUserId: REVIEWER.id,
          status: 'PENDING',
        },
      ],
    });
    useAuthStore.setState({ currentUser: REVIEWER });
    renderDashboard();

    expect(tileCount('Total Queries')).toBe(1);
    expect(tileCount('Awaiting My Review')).toBe(0);
    expect(tileCount('Approved by me')).toBe(0);
    expect(tileCount('Returned by me')).toBe(0);

    fireEvent.click(tile('Total Queries'));
    expect(visibleQueryIds()).toEqual(['QRY-PENDING-LEVEL']);
  });
});

describe('the query list is vertically contained', () => {
  it('scrolls the rows in place instead of growing the dashboard', () => {
    seed(
      Array.from({ length: 25 }, (_, i) => ({
        queryId: `QRY-${String(i).padStart(3, '0')}`,
        subject: `Case ${i}`,
        workflowState: WORKFLOW_STATE.RECEIVED,
      })),
    );
    useAuthStore.setState({ currentUser: FRONT_OFFICE });
    renderDashboard();

    const viewport = listPanel().querySelector('[data-radix-scroll-area-viewport]');
    expect(viewport).not.toBeNull();
    expect(viewport.closest('[data-slot="scroll-area"]').className).toMatch(/max-h-/);

    expect(visibleQueryIds()).toHaveLength(25);
    expect(tileCount('Total Queries')).toBe(25);
  });

  it('leaves the header and footer outside the scroll area', () => {
    seed([{ queryId: 'QRY-1', subject: 'One', workflowState: WORKFLOW_STATE.RECEIVED }]);
    useAuthStore.setState({ currentUser: FRONT_OFFICE });
    renderDashboard();

    const scroller = listPanel().querySelector('[data-slot="scroll-area"]');
    expect(scroller).not.toBeNull();
    expect(scroller.textContent).not.toMatch(/Showing/);
    expect(scroller.querySelector('h2')).toBeNull();
  });
});

describe('the dashboard invents nothing', () => {
  it('shows none of the hard-coded rows it used to ship with', () => {
    useAuthStore.setState({ currentUser: OIC });
    renderDashboard();

    for (const invented of [
      'Q-2034',
      'Q-2031',
      'Staff access request for new ERP module',
      'Compliance report Q2 amendment required',
      '91%',
      'Tech Ops',
    ]) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('starts from an empty store — nothing is seeded', async () => {
    await useWorkflowStore.getState().resetDemo();
    const state = useWorkflowStore.getState();
    expect(state.queries).toEqual([]);
    expect(state.workflowSteps).toEqual([]);
    expect(state.auditEvents).toEqual([]);
  });
});
