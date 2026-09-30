import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { AutoTransferTimerCard } from '@/components/workflow/AutoTransferTimerCard';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  WORKFLOW_STATE,
  BUSINESS_STATUS,
  AUDIT_EVENT,
  AUDIT_EVENT_LABELS,
  SERVER_EVENTS,
} from '@/constants/statusEnums';
import { findUserById } from '@/constants/mockUsers';

const OFFICIAL_A = findUserById('USR-0004');
const OFFICIAL_B = findUserById('USR-0010');
const OIC = findUserById('USR-0003');
const NOW = Date.parse('2026-09-30T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const assigned = (overrides = {}) => ({
  queryId: 'QRY-UI-001',
  subject: 'HPLC column validation',
  workflowState: WORKFLOW_STATE.ASSIGNED,
  businessStatus: BUSINESS_STATUS.IN_PROGRESS,
  currentAssigneeId: OFFICIAL_A.id,
  assignedAt: iso(NOW),
  actionDeadline: iso(NOW + 2 * 60 * 1000),
  autoTransferCount: 0,
  transferHistory: [],
  ...overrides,
});

describe('the automatic transfer timer card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down to the deadline the server set', async () => {
    render(<AutoTransferTimerCard query={assigned()} />);

    expect(screen.getByText('Action Timeline & Auto Transfer Status')).toBeInTheDocument();
    expect(screen.getByText(OFFICIAL_A.name)).toBeInTheDocument();
    expect(screen.getByTestId('auto-transfer-countdown')).toHaveTextContent('2m 00s');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75 * 1000);
    });
    expect(screen.getByTestId('auto-transfer-countdown')).toHaveTextContent('0m 45s');
  });

  it('shows the limit the server used rather than a fixed two minutes', () => {
    render(<AutoTransferTimerCard query={assigned({ actionDeadline: iso(NOW + 5 * 60 * 1000) })} />);

    expect(screen.getByText('Limit: 5 min')).toBeInTheDocument();
    expect(screen.getByTestId('auto-transfer-countdown')).toHaveTextContent('5m 00s');
    expect(screen.queryByText(/Testing/)).toBeNull();
  });

  it('refreshes the case after the deadline passes so the new officer appears', async () => {
    const revalidate = vi.fn();
    const original = useWorkflowStore.getState().revalidate;
    useWorkflowStore.setState({ revalidate });
    try {
      const { unmount } = render(<AutoTransferTimerCard query={assigned({ actionDeadline: iso(NOW - 1000) })} />);
      expect(screen.getByText(/Deadline passed/)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(revalidate).toHaveBeenCalled();
      unmount();
    } finally {
      useWorkflowStore.setState({ revalidate: original });
    }
  });

  it('disappears once the officer acts and the case leaves ASSIGNED', () => {
    const { container } = render(<AutoTransferTimerCard query={assigned({ workflowState: WORKFLOW_STATE.DRAFTING })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for an older assignment that has no server deadline', () => {
    const { container } = render(
      <AutoTransferTimerCard query={assigned({ assignedAt: undefined, actionDeadline: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('explains a stopped transfer when no eligible official remains', () => {
    render(<AutoTransferTimerCard query={assigned({ actionDeadline: null, autoTransferFailed: true })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('no eligible recommended official remains');
    expect(screen.getByText(/Stopped — no eligible official left/)).toBeInTheDocument();
    expect(screen.queryByTestId('auto-transfer-countdown')).toBeNull();
  });

  it('lists automatic and manual transfers with their reasons', () => {
    render(
      <AutoTransferTimerCard
        query={assigned({
          currentAssigneeId: OFFICIAL_B.id,
          autoTransferCount: 1,
          transferHistory: [
            {
              fromAssigneeId: OFFICIAL_A.id,
              toAssigneeId: OFFICIAL_B.id,
              transferredAt: iso(NOW - 60000),
              reason: 'No action within the 2-minute action limit',
              transferType: 'AUTO_TRANSFER',
              matchPercent: 80,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Transfer History (1)')).toBeInTheDocument();
    expect(screen.getByText('AUTOMATIC')).toBeInTheDocument();
    expect(screen.getByText(/No action within the 2-minute action limit \(AI match 80%\)/)).toBeInTheDocument();
  });
});

describe('assigning and transferring from the browser', () => {
  beforeEach(async () => {
    await useWorkflowStore.getState().hydrate();
    await useWorkflowStore.getState().resetDemo();
  });

  const pendingCase = () => {
    const query = {
      queryId: 'QRY-2026-09901',
      subject: 'Assay limits for a modified-release tablet',
      description: 'Please clarify the assay limit.',
      workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
      businessStatus: BUSINESS_STATUS.IN_PROGRESS,
      currentAssigneeId: null,
      threadId: 'TRD-2026-09901',
      inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
      createdAt: '2026-09-30T09:00:00.000Z',
      updatedAt: '2026-09-30T09:00:00.000Z',
    };
    useWorkflowStore.setState((state) => ({ queries: [...state.queries, query] }));
    return query;
  };

  it('sends the ranking the OIC saw, and no deadline of its own', () => {
    const query = pendingCase();
    const ranking = [
      { userId: OFFICIAL_A.id, matchPercent: 98, name: 'ignored' },
      { userId: OFFICIAL_B.id, matchPercent: 80 },
    ];
    useAuthStore.setState({ currentUser: OIC });

    useWorkflowStore.getState().assignQuery(query.queryId, OFFICIAL_A.id, OIC, ranking);

    const updated = useWorkflowStore.getState().queries.find((q) => q.queryId === query.queryId);
    expect(updated.currentAssigneeId).toBe(OFFICIAL_A.id);
    expect(updated.assignmentDecision.ranking).toEqual([
      { userId: OFFICIAL_A.id, matchPercent: 98 },
      { userId: OFFICIAL_B.id, matchPercent: 80 },
    ]);
    expect(updated.actionDeadline).toBeUndefined();
    expect(updated.assignedAt).toBeUndefined();
  });

  it('keeps a manual transfer to the assignee change alone, as before', () => {
    const query = pendingCase();
    useWorkflowStore.getState().assignQuery(query.queryId, OFFICIAL_A.id, OIC);

    useWorkflowStore.getState().transferQuery(query.queryId, OFFICIAL_B.id, 'On leave', OFFICIAL_A);

    const updated = useWorkflowStore.getState().queries.find((q) => q.queryId === query.queryId);
    expect(updated.currentAssigneeId).toBe(OFFICIAL_B.id);
    expect(updated.transferHistory).toBeUndefined();
    expect(updated.actionDeadline).toBeUndefined();
    const audit = useWorkflowStore.getState().auditEvents.filter((e) => e.queryId === query.queryId);
    expect(audit.at(-1).event).toBe(AUDIT_EVENT.QUERY_TRANSFERRED);
  });

  it('names automatic transfers in the case history', () => {
    expect(AUDIT_EVENT_LABELS[SERVER_EVENTS.QUERY_AUTO_TRANSFERRED]).toBe('Automatically transferred');
    expect(AUDIT_EVENT_LABELS[SERVER_EVENTS.QUERY_AUTO_TRANSFER_FAILED]).toBe('Automatic transfer stopped');
    expect(Object.values(AUDIT_EVENT)).not.toContain(SERVER_EVENTS.QUERY_AUTO_TRANSFERRED);
  });
});
