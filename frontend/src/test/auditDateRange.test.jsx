import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api/adminService');

import * as adminService from '@/services/api/adminService';
import { AdminActivityPage } from '@/pages/admin/AdminActivityPage';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { toServerRange } from '@/utils/dateRange';

describe('the audit date range sent to the server', () => {
  it('covers the whole of each picked day in the viewer’s time zone', () => {
    const { from, to } = toServerRange({ from: '2026-09-01', to: '2026-09-30' });
    const start = new Date(from);
    const end = new Date(to);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 8, 1, 0, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      2026, 8, 30, 23, 59, 59, 999,
    ]);
  });

  it('passes a full timestamp and empty values through', () => {
    expect(toServerRange({ from: '2026-09-01T05:00:00.000Z', to: '', action: 'EMAIL_SENT' })).toEqual({
      from: '2026-09-01T05:00:00.000Z',
      to: '',
      action: 'EMAIL_SENT',
    });
  });

  it('is what the Audit Trail asks for, and what it exports', async () => {
    vi.mocked(adminService.fetchAuditEvents).mockResolvedValue({ events: [], total: 0 });
    vi.mocked(adminService.verifyAuditChain).mockResolvedValue({ ok: true, checked: 0, breaks: [] });
    vi.mocked(adminService.downloadAuditReport).mockResolvedValue({ fileName: 'a.csv', digest: 'x', rows: 0 });
    useAuthStore.setState({ currentUser: findUserById('USR-0007') });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminActivityPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const [fromInput, toInput] = container.querySelectorAll('input[type="date"]');
    fireEvent.change(fromInput, { target: { value: '2026-09-30' } });
    fireEvent.change(toInput, { target: { value: '2026-09-30' } });

    const expected = toServerRange({ from: '2026-09-30', to: '2026-09-30' });
    await waitFor(() =>
      expect(adminService.fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ from: expected.from, to: expected.to })),
    );
    expect(toInput).toHaveValue('2026-09-30');

    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() =>
      expect(adminService.downloadAuditReport).toHaveBeenCalledWith('csv', expect.objectContaining({ to: expected.to })),
    );
  });
});
