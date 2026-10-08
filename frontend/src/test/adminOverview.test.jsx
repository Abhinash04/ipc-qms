import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT, BUSINESS_STATUS } from '@/constants/statusEnums';
import {
  periodDelta,
  processingFunnel,
  volumeByDay,
  caseTrend,
  statusDistribution,
  yesterdayWindow,
} from '@/components/admin/adminStats';

vi.mock('@/services/api/adminService');
vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy', service: 'qms-backend' }),
}));
vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi
    .fn()
    .mockResolvedValue({ transport: 'mock', ipcQueryEmail: 'ipc@test.invalid', participants: [] }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  deleteMailboxMessage: vi.fn().mockResolvedValue({ deleted: true }),  sendAcknowledgement: vi.fn().mockResolvedValue({}),
  forwardQuery: vi.fn().mockResolvedValue({}),
  sendResponse: vi.fn().mockResolvedValue({}),
}));

import * as adminService from '@/services/api/adminService';

const ADMIN = findUserById('USR-0007');

const period = (over) => ({
  total: 0,
  byAction: {},
  byResult: {},
  byActorType: {},
  backend: 'mongo',
  durable: true,
  ...over,
});

const summaryOf = (today, overall = today) => ({ overall, today });

function renderOverview() {
  useAuthStore.setState({ currentUser: ADMIN, authReady: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/administration']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const daysAgo = (n) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - n);
  return date.toISOString();
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(adminService.fetchAuditEvents).mockResolvedValue({ events: [], count: 0, durable: true });
  vi.mocked(adminService.fetchAuditForQuery).mockResolvedValue({ queryId: 'QRY-1', events: [], count: 0 });

  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
});

describe('periodDelta refuses to invent a trend', () => {
  it('reports no change when both windows are empty', () => {
    expect(periodDelta(0, 0)).toMatchObject({ text: 'No change', direction: 'flat' });
  });

  it('never renders a percentage against a zero baseline', () => {
    const delta = periodDelta(5, 0);

    expect(delta.text).toBe('New activity');
    expect(delta.text).not.toMatch(/%/);
    expect(delta.percent).toBeNull();
  });

  it('computes a real percentage in both directions', () => {
    expect(periodDelta(12, 10)).toMatchObject({ text: '+20%', direction: 'up' });
    expect(periodDelta(10, 12)).toMatchObject({ text: '-17%', direction: 'down' });
  });

  it('does not claim "no change" for a change too small to round', () => {
    const delta = periodDelta(1001, 1000);
    expect(delta.text).toBe('<1% change');
    expect(delta.direction).toBe('up');
  });
});

describe('the case aggregations count real records', () => {
  it('counts a case once even when QUERY_RECEIVED is recorded twice for it', () => {
    const events = [
      { event: AUDIT_EVENT.QUERY_RECEIVED, queryId: 'QRY-1' },
      { event: AUDIT_EVENT.QUERY_RECEIVED, queryId: 'QRY-1' },
      { event: AUDIT_EVENT.QUERY_RECEIVED, queryId: 'QRY-2' },
      { event: AUDIT_EVENT.QUERY_FORWARDED, queryId: 'QRY-1' },
    ];

    const funnel = processingFunnel(events);
    expect(funnel[0]).toMatchObject({ label: 'Queries received', value: 2 });
    expect(funnel[2]).toMatchObject({ label: 'Forwarded to OIC', value: 1 });
  });

  it('buckets a case created after local midnight into today', () => {
    const justAfterMidnight = new Date();
    justAfterMidnight.setHours(0, 30, 0, 0);

    const days = volumeByDay([{ createdAt: justAfterMidnight.toISOString() }]);

    expect(days).toHaveLength(7);
    expect(days[6].value).toBe(1);
    expect(days.reduce((sum, d) => sum + d.value, 0)).toBe(1);
  });

  it('compares the last seven days against the seven before them', () => {
    const trend = caseTrend([
      { createdAt: daysAgo(1) },
      { createdAt: daysAgo(3) },
      { createdAt: daysAgo(9) },
      { createdAt: daysAgo(30) },
    ]);

    expect(trend.current).toBe(2);
    expect(trend.previous).toBe(1);
    expect(trend.delta.text).toBe('+100%');
  });

  it('splits cases by their real business status', () => {
    const distribution = statusDistribution([
      { businessStatus: BUSINESS_STATUS.OPEN },
      { businessStatus: BUSINESS_STATUS.CLOSED },
      { businessStatus: BUSINESS_STATUS.CLOSED },
    ]);

    expect(distribution).toEqual([
      { label: 'Open', value: 1 },
      { label: 'In progress', value: 0 },
      { label: 'Closed', value: 2 },
    ]);
  });

  it('asks the server for yesterday, not for a number it made up', () => {
    const { from, to } = yesterdayWindow();
    expect(new Date(to) - new Date(from)).toBe(24 * 60 * 60 * 1000);
  });
});

describe('the KPI trend is wired to a second windowed request', () => {
  it('renders a delta computed from the comparison window', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockImplementation((filters = {}) =>
      Promise.resolve(
        filters.from
          ? summaryOf(period({ total: 10 }), period({ total: 10 }))
          : summaryOf(period({ total: 12 }), period({ total: 12 })),
      ),
    );

    renderOverview();

    await screen.findByText('System events today');
    await screen.findByText('+20%');

    await waitFor(() => {
      expect(adminService.fetchAuditSummary).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      );
    });
  });

  it('shows no change rather than a spike when yesterday was empty', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockResolvedValue(
      summaryOf(period({ total: 0 }), period({ total: 0 })),
    );

    renderOverview();

    await screen.findByText('System events today');
    const noChange = await screen.findAllByText('No change');
    expect(noChange.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
  });

  it('offers no trend at all while the comparison window is unavailable', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockImplementation((filters = {}) =>
      filters.from
        ? Promise.reject(new Error('audit unavailable'))
        : Promise.resolve(summaryOf(period({ total: 7 }), period({ total: 7 }))),
    );

    renderOverview();

    const label = await screen.findByText('System events today');
    const tile = label.closest('a');

    await waitFor(() => {
      expect(tile).toHaveTextContent('7');
      expect(tile).not.toHaveTextContent('No change');
      expect(tile).not.toHaveTextContent('vs yesterday');
      expect(tile).not.toHaveTextContent('%');
    });
  });

  it('carries the failures deep link through to a server-side filter', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockResolvedValue(
      summaryOf(period({ total: 0 }), period({ total: 0 })),
    );

    useAuthStore.setState({ currentUser: ADMIN, authReady: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/administration/activity?result=failure']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(adminService.fetchAuditEvents).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'failure' }),
      );
    });
    expect(await screen.findByLabelText('Result')).toHaveValue('failure');
  });

  it('keeps a single alert when the audit API is unreachable', async () => {
    vi.mocked(adminService.fetchAuditSummary).mockRejectedValue(new Error('offline'));

    renderOverview();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('System activity unavailable');
  });
});
