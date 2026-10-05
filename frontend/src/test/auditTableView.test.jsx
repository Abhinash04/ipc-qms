import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AuditTable } from '@/components/admin/AuditTable';

const EVENT = {
  timestamp: '2026-10-01T05:11:09.000Z',
  action: 'EMAIL_SEND_FAILED',
  result: 'failure',
  actorType: 'human',
  actorId: 'USR-0014',
  actorRole: 'FRONT_OFFICE',
  queryId: 'QRY-2026-00043',
  details: { to: 'ravi@pharma.example' },
  view: {
    auditId: 'AUD-000041',
    previousValue: 'Pending assignment',
    newValue: 'Assigned',
    sessionId: 'SES-1A2B3C4D',
    section: 'Administration',
    logSource: 'qms-app-01',
    who: 'Priya Sharma (Front Office)',
    did: 'Forwarded query QRY-2026-00043 for assignment',
    other: 'To: EduTR Zairza (Officer-in-Charge)',
    user: 'Priya Sharma',
    userCard: { name: 'Priya Sharma', role: 'Front Office', id: 'USR-0014' },
    userId: 'USR-0014',
    role: 'Front Office',
    ipAddress: '10.21.4.18',
    device: 'Chrome 140 on Windows',
    module: 'Email',
    activity: 'Email could not be sent',
    caseNo: 'QRY-2026-00043',
    status: 'Failed',
    details: 'Error: SMTP connection timed out. To: ravi@pharma.example',
  },
};

describe('the audit trail table', () => {
  it('shows who did what, with an arrow, in plain words', () => {
    render(<AuditTable events={[EVENT]} />);
    const row = screen.getByText('By: Priya Sharma (Front Office)').closest('tr');

    expect(within(row).getAllByText('→')).toHaveLength(2);
    expect(within(row).getByText('Forwarded query QRY-2026-00043 for assignment')).toBeInTheDocument();
    expect(within(row).getByText('To: EduTR Zairza (Officer-in-Charge)')).toBeInTheDocument();
    expect(within(row).getByText('10.21.4.18')).toBeInTheDocument();
    expect(screen.queryByText(/Changed:/)).toBeNull();
    expect(within(row).getByText('AUD-000041')).toBeInTheDocument();
    expect(screen.queryByText(/EMAIL_SEND_FAILED/)).toBeNull();
  });

  it('names the user with their role and user ID', () => {
    render(<AuditTable events={[EVENT]} />);
    const row = screen.getByText('By: Priya Sharma (Front Office)').closest('tr');

    expect(screen.getByRole('columnheader', { name: 'User' })).toBeInTheDocument();
    expect(within(row).getByText('Priya Sharma')).toBeInTheDocument();
    expect(within(row).getByText('Front Office')).toBeInTheDocument();
    expect(within(row).getByText('ID: USR-0014')).toBeInTheDocument();
  });

  it('says when an activity was saved without an audit ID', () => {
    render(<AuditTable events={[{ ...EVENT, view: { ...EVENT.view, auditId: '-' } }]} />);

    expect(screen.getByText('Not issued')).toHaveAttribute('title', expect.stringMatching(/does not give audit IDs/));
  });

  it('expands to the description in sentences, with the browser', () => {
    render(<AuditTable events={[EVENT]} />);
    fireEvent.click(screen.getByRole('button', { name: /Show details/ }));

    expect(screen.getByText('Error: SMTP connection timed out. To: ravi@pharma.example')).toBeInTheDocument();
    expect(screen.getByText(/Browser: Chrome 140 on Windows/)).toBeInTheDocument();
    expect(screen.getByText(/Login session SES-1A2B3C4D/)).toBeInTheDocument();
    expect(screen.queryByText(/\{"/)).toBeNull();
  });
});
