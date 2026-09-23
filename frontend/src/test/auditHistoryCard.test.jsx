import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { AuditHistoryCard } from '@/components/workflow/AuditHistoryCard';

const clientRow = {
  auditId: 'AUD-00007',
  queryId: 'QRY-2026-00001',
  event: 'QUERY_REGISTERED',
  actor: 'Front Office (primary mailbox)',
  at: '2026-09-17T09:05:00.000Z',
  details: 'Front Office verified the query details and attachments.',
};

const serverRow = {
  auditId: '68c9f2a1b4d3e5f600000001',
  queryId: 'QRY-2026-00001',
  event: 'QUERY_RECEIVED',
  actor: 'FRONT_OFFICE',
  at: '2026-09-17T09:00:00.000Z',
  details: { method: 'POST', path: '/queries/accept', reason: 'mailbox accept' },
};

const rows = () => within(screen.getByRole('table')).getAllByRole('row');

describe('the audit card renders both shapes of an audit row', () => {
  it('shows a client sentence and a server record in the same table', () => {
    render(<AuditHistoryCard audit={[serverRow, clientRow]} />);

    expect(rows()).toHaveLength(3);

    expect(screen.getByText('QUERY REGISTERED')).toBeInTheDocument();
    expect(screen.getByText('QUERY RECEIVED')).toBeInTheDocument();
    expect(screen.getByText(/Front Office \(primary mailbox\)/)).toBeInTheDocument();
    expect(screen.getByText(/FRONT_OFFICE/)).toBeInTheDocument();

    expect(screen.getByText(clientRow.details)).toBeInTheDocument();
  });

  it('reads an object details back as text instead of throwing on it', () => {
    render(<AuditHistoryCard audit={[serverRow]} />);

    const detailsCell = screen.getByText(/method: POST/);
    expect(detailsCell).toHaveTextContent('path: /queries/accept');
    expect(detailsCell).toHaveTextContent('reason: mailbox accept');

    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it('falls back to a placeholder when a row carries no details at all', () => {
    render(<AuditHistoryCard audit={[{ ...clientRow, details: null }]} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('the audit card keys its rows without a React warning', () => {
  it('keys rows that predate auditId', () => {
    const legacy = [
      {
        queryId: 'QRY-2026-00001',
        event: 'DRAFT_GENERATED',
        actor: 'AI Draft Assistant',
        at: '2026-09-17T11:00:00.000Z',
        details: 'AI generated response version v1.',
      },
      {
        queryId: 'QRY-2026-00001',
        event: 'DRAFT_UPDATED',
        actor: 'Neha Singh',
        at: '2026-09-17T11:30:00.000Z',
        details: 'Officer revision saved as v2.',
      },
    ];

    render(<AuditHistoryCard audit={legacy} />);

    expect(rows()).toHaveLength(3);
    expect(screen.getByText('AI generated response version v1.')).toBeInTheDocument();
    expect(screen.getByText('Officer revision saved as v2.')).toBeInTheDocument();
  });

  it('keys a mixed trail of server, client and legacy rows', () => {
    const legacy = {
      queryId: 'QRY-2026-00001',
      event: 'ACKNOWLEDGEMENT_SENT',
      actor: 'System',
      at: '2026-09-17T09:02:00.000Z',
      details: 'Acknowledgement email sent to someone@example.com.',
    };

    render(<AuditHistoryCard audit={[serverRow, legacy, clientRow]} />);

    expect(rows()).toHaveLength(4);
    expect(screen.getByText('3 Total Events')).toBeInTheDocument();
  });
});
