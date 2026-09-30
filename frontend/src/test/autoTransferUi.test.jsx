import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AutoTransferTimerCard } from '@/components/workflow/AutoTransferTimerCard';
import { WORKFLOW_STATE, BUSINESS_STATUS } from '@/constants/statusEnums';
import { findUserById } from '@/constants/mockUsers';

describe('AutoTransferTimerCard Component Tests', () => {
  const OFFICIAL_A = findUserById('USR-0004'); // Neha Singh
  const OFFICIAL_B = findUserById('USR-0010'); // Meera Iyer

  it('renders assignment officer, assignment time, deadline, remaining time, and 2-minute testing notice', () => {
    const assignedAt = new Date().toISOString();
    const actionDeadline = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const query = {
      queryId: 'QRY-UI-001',
      subject: 'HPLC Column Validation',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICIAL_A.id,
      assignedAt,
      actionDeadline,
      autoTransferCount: 0,
      transferType: 'INITIAL',
      transferHistory: [],
    };

    render(<AutoTransferTimerCard query={query} />);

    expect(screen.getByText('Action Timeline & Auto Transfer Status')).toBeInTheDocument();
    expect(screen.getByText('Timeline: 2 Min (Testing)')).toBeInTheDocument();
    expect(screen.getByText(OFFICIAL_A.name)).toBeInTheDocument();
    expect(screen.getByText(/Remaining Time/i)).toBeInTheDocument();
    expect(screen.getByText(/Action Pending/i)).toBeInTheDocument();
  });

  it('renders automatic transfer history when query has been transferred', () => {
    const timestamp = new Date().toISOString();
    const query = {
      queryId: 'QRY-UI-002',
      subject: 'Sterility Testing Protocol',
      workflowState: WORKFLOW_STATE.ASSIGNED,
      businessStatus: BUSINESS_STATUS.OPEN,
      currentAssigneeId: OFFICIAL_B.id,
      assignedAt: timestamp,
      actionDeadline: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      autoTransferCount: 1,
      transferType: 'AUTO_TRANSFER',
      transferHistory: [
        {
          fromAssigneeId: OFFICIAL_A.id,
          toAssigneeId: OFFICIAL_B.id,
          transferredAt: timestamp,
          reason: 'Automatic transfer after 2-minute action limit',
          transferType: 'AUTO_TRANSFER',
        },
      ],
    };

    render(<AutoTransferTimerCard query={query} />);

    expect(screen.getByText('Transfer History (1)')).toBeInTheDocument();
    expect(screen.getAllByText(OFFICIAL_A.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(OFFICIAL_B.name).length).toBeGreaterThan(0);
    expect(screen.getByText('AUTOMATIC')).toBeInTheDocument();
    expect(screen.getByText('Automatic transfer after 2-minute action limit')).toBeInTheDocument();
  });

  it('indicates when officer has taken required action (workflow state moved beyond ASSIGNED)', () => {
    const query = {
      queryId: 'QRY-UI-003',
      subject: 'Monograph Reference Standard',
      workflowState: WORKFLOW_STATE.DRAFTING,
      businessStatus: BUSINESS_STATUS.IN_PROGRESS,
      currentAssigneeId: OFFICIAL_A.id,
      assignedAt: new Date().toISOString(),
      actionDeadline: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };

    render(<AutoTransferTimerCard query={query} />);

    expect(screen.getByText(/Action Completed \(DRAFTING\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Officer Acted \(DRAFTING\)/i)).toBeInTheDocument();
  });
});
