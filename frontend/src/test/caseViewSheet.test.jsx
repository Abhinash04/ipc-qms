import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api/adminService');

import * as adminService from '@/services/api/adminService';
import { AdminActivityPage } from '@/pages/admin/AdminActivityPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';

const QUERY_ID = 'QRY-2026-00001';

const AUDIT_ROW = {
  _id: 'a1',
  timestamp: '2026-10-01T10:29:55.000Z',
  action: 'QUERY_CLOSED',
  actorType: 'human',
  actorId: 'USR-0003',
  queryId: QUERY_ID,
  result: 'success',
  view: {
    auditId: 'AUD-000090',
    who: 'EduTR Zairza (Officer-in-Charge)',
    did: `Closed query ${QUERY_ID}`,
    other: '',
    userCard: { name: 'EduTR Zairza', role: 'Officer-in-Charge', id: 'USR-0003' },
  },
};

function renderPage() {
  vi.mocked(adminService.fetchAuditEvents).mockResolvedValue({ events: [AUDIT_ROW], total: 1 });
  vi.mocked(adminService.fetchAuditForQuery).mockResolvedValue({ queryId: QUERY_ID, events: [AUDIT_ROW], count: 1 });
  vi.mocked(adminService.verifyAuditChain).mockResolvedValue({ ok: true, checked: 1, breaks: [] });
  useAuthStore.setState({ currentUser: findUserById('USR-0007') });
  useWorkflowStore.setState({
    queries: [
      {
        queryId: QUERY_ID,
        subject: 'Monograph clarification for Paracetamol',
        description: 'Please clarify the assay limits.',
        source: 'Email',
        inquirer: { name: 'Ravi Kumar', email: 'ravi@pharma.example' },
        priority: 'NORMAL',
        workflowState: 'CLOSED',
        currentAssigneeId: 'USR-0011',
        createdAt: '2026-10-01T10:05:06.000Z',
        updatedAt: '2026-10-01T10:29:55.000Z',
      },
    ],
    responseVersions: [{ responseId: 'R1', queryId: QUERY_ID, version: 'v1', label: 'Approved', content: 'The assay limits are 98.0–102.0%.' }],
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/administration/activity']}>
        <Routes>
          <Route path="/admin/administration/activity" element={<AdminActivityPage />} />
          <Route path="*" element={<p>Left the audit trail</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('opening a case from the audit trail', () => {
  it('shows the case page read-only, without leaving the audit trail', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QUERY_ID }));

    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('View only')).toBeInTheDocument();
    expect(within(panel).getByText('Monograph clarification for Paracetamol')).toBeInTheDocument();
    expect(within(panel).getByText('Workflow progress')).toBeInTheDocument();
    expect(within(panel).getByText('Case details')).toBeInTheDocument();
    expect(within(panel).getByText('The assay limits are 98.0–102.0%.')).toBeInTheDocument();

    // Every section still opens: the Query Info tab shows the enquiry itself.
    fireEvent.mouseDown(within(panel).getByRole('tab', { name: 'Query Info' }));
    fireEvent.click(within(panel).getByRole('tab', { name: 'Query Info' }));
    expect(await within(panel).findByText('Please clarify the assay limits.')).toBeInTheDocument();

    // Nothing in it acts on the case.
    expect(within(panel).queryByText(/Available actions/i)).toBeNull();
    for (const action of [/Pullback/i, /Re-generate/i, /Generate AI Summary/i, /Assign/i, /Approve/i, /Dispatch/i]) {
      expect(within(panel).queryByRole('button', { name: action })).toBeNull();
    }
    expect(within(panel).queryByRole('navigation', { name: /breadcrumb/i })).toBeNull();
    expect(screen.queryByText('Left the audit trail')).toBeNull();
  });
});
