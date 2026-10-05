import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api/adminService');
vi.mock('@/services/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import * as adminService from '@/services/api/adminService';
import { notify } from '@/services/notify';
import { AuditExportButtons, ChainIntegrityBadge } from '@/components/admin/AuditIntegrity';

function withClient(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(adminService.verifyAuditChain).mockReset();
  vi.mocked(adminService.downloadAuditReport).mockReset();
  vi.mocked(notify.success).mockReset();
  vi.mocked(notify.error).mockReset();
});

describe('the chain integrity badge', () => {
  it('says the chain is verified, with how many events were checked', async () => {
    vi.mocked(adminService.verifyAuditChain).mockResolvedValue({
      ok: true,
      checked: 1204,
      legacy: 12,
      unpersisted: 0,
      breaks: [],
      firstBreak: null,
    });
    withClient(<ChainIntegrityBadge />);

    expect(await screen.findByText('Chain verified · 1,204 events')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('12 legacy'));
  });

  it('names the first broken position when the chain has been tampered with', async () => {
    vi.mocked(adminService.verifyAuditChain).mockResolvedValue({
      ok: false,
      checked: 50,
      legacy: 0,
      unpersisted: 0,
      breaks: [{ seq: 17, reason: 'hash', detail: 'event #17 was altered after it was recorded' }],
      firstBreak: { seq: 17, reason: 'hash', detail: 'event #17 was altered after it was recorded' },
    });
    withClient(<ChainIntegrityBadge />);

    expect(await screen.findByText('Break detected at #17')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('altered'));
  });

  it('re-checks on demand', async () => {
    vi.mocked(adminService.verifyAuditChain).mockResolvedValue({ ok: true, checked: 1, breaks: [] });
    withClient(<ChainIntegrityBadge />);
    await screen.findByText('Chain verified · 1 events');

    fireEvent.click(screen.getByRole('button', { name: 'Re-check the audit chain' }));
    await waitFor(() => expect(adminService.verifyAuditChain).toHaveBeenCalledTimes(2));
  });
});

describe('the export buttons', () => {
  it('download the report for the current filters and show its digest', async () => {
    vi.mocked(adminService.downloadAuditReport).mockResolvedValue({
      fileName: 'ipc-qms-audit.pdf',
      digest: 'abcdef0123456789abcdef',
      rows: 42,
      truncated: false,
      chainVerified: true,
    });
    const filters = { action: 'QUERY_ASSIGNED', from: '2026-09-01' };
    withClient(<AuditExportButtons filters={filters} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    await waitFor(() => expect(notify.success).toHaveBeenCalled());
    expect(adminService.downloadAuditReport).toHaveBeenCalledWith('pdf', filters);
    expect(notify.success).toHaveBeenCalledWith('Exported 42 audit events', expect.stringContaining('abcdef0123456789'));
  });

  it('reports a failed export instead of failing silently', async () => {
    vi.mocked(adminService.downloadAuditReport).mockRejectedValue(new Error('500'));
    withClient(<AuditExportButtons filters={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Export failed', expect.any(String)));
  });
});
