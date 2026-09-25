import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { axiosClient } from '@/services/api/axiosClient';
import { notify, beginBatch, endBatch } from '@/services/notify';
import { notifyMailboxCheck } from '@/hooks/useMailboxIngestion';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import * as mailboxService from '@/services/api/mailboxService';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { persistQueryTransition as writeOnServer } from '@/test/fakeQueryApi';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');

const s = () => useWorkflowStore.getState();

const enquiry = (id = 'MSG-NOTIF-0001') => ({
  mailboxMessageId: id,
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Endotoxin limits clarification',
  body: 'Please clarify.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const received = (id) => s().ingestEmail(enquiry(id), async () => null).queryId;

const verified = (queryId) => act(() => s().verifyQuery(queryId, FRONT_OFFICE));

const forwarded = (queryId) => act(() => s().forwardToOic(queryId, FRONT_OFFICE));

const originalAdapter = axiosClient.defaults.adapter;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({});
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  installFakeCaseMail(mailboxService);

  await s().hydrate();
  await s().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });

  notify.dismiss();
});

afterEach(() => {
  axiosClient.defaults.adapter = originalAdapter;
  notify.dismiss();
});

describe('toasts follow committed transitions, not clicks', () => {
  it('raises no success toast when the forward actually fails', async () => {
    installFakeCaseMail(mailboxService, { forward: { outcome: 'FAILED', error: 'SMTP down' } });
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await expect(forwarded(queryId)).rejects.toThrow(/SMTP down/);

    await waitFor(() => {
      expect(
        s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED),
      ).toBe(false);
    });
    expect(
      screen.queryByText('Forwarded to the Officer-in-Charge'),
    ).not.toBeInTheDocument();
  });

  it('raises the success toast once the same call succeeds', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);

    expect(
      s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED),
    ).toBe(true);
    await screen.findByText('Forwarded to the Officer-in-Charge');
  });

  it('says nothing for events that are audited but deliberately silent', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);
    act(() => s().assignQuery(queryId, OFFICIAL.id, OIC));
    await screen.findByText('Query assigned');

    act(() => s().saveDraftVersion(queryId, 'A revised draft body.', OFFICIAL));

    expect(
      s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.DRAFT_UPDATED),
    ).toBe(true);
    expect(screen.queryByText('Draft response updated')).not.toBeInTheDocument();
  });
});

describe('history is never replayed as news', () => {
  it('re-baselines when resetDemo replaces the state', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);
    await screen.findByText('Forwarded to the Officer-in-Charge');

    await act(() => s().resetDemo());
    expect(s().auditEvents).toHaveLength(0);

    const next = received('MSG-NOTIF-0002');
    await verified(next);
    await forwarded(next);
    act(() => s().assignQuery(next, OFFICIAL.id, OIC));

    await screen.findByText('Query assigned');
    expect(screen.getAllByText('Query assigned')).toHaveLength(1);
  });

  it("stays quiet about a colleague's forward that a background reload brings in", async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await writeOnServer({
      auditEvent: {
        auditId: 'AUD-09001',
        queryId,
        event: AUDIT_EVENT.QUERY_FORWARDED,
        actor: 'A colleague',
        at: '2026-08-26T10:00:00.000Z',
        details: `${queryId} forwarded by a colleague.`,
      },
    });

    await act(() => s().refreshFromServer({ quiet: true }));
    expect(s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED)).toBe(true);

    notify.info('marker');
    await screen.findByText('marker');
    expect(screen.queryByText('Forwarded to the Officer-in-Charge')).not.toBeInTheDocument();
  });

  it('emits nothing for the events already present when it mounts', async () => {
    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);

    render(<NotificationHost />);

    await waitFor(() => {
      expect(
        screen.queryByText('Forwarded to the Officer-in-Charge'),
      ).not.toBeInTheDocument();
    });
  });
});

describe('a mailbox sweep reports itself once', () => {
  it('suppresses the per-case toasts inside a batch', async () => {
    render(<NotificationHost />);

    beginBatch();
    try {
      const queryId = received();
      await verified(queryId);
      await forwarded(queryId);
    } finally {
      endBatch();
    }

    expect(s().auditEvents.some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED)).toBe(true);
    expect(
      screen.queryByText('Forwarded to the Officer-in-Charge'),
    ).not.toBeInTheDocument();

    notifyMailboxCheck({ fetched: 1 });
    await screen.findByText('1 message awaiting validation');
  });

  it('reports mail as waiting, never as registered', async () => {
    render(<NotificationHost />);

    notifyMailboxCheck({ fetched: 3 });

    await screen.findByText('3 messages awaiting validation');
    expect(screen.queryByText(/registered/)).not.toBeInTheDocument();
  });

  it('stays quiet when a background poll finds nothing', async () => {
    render(<NotificationHost />);

    notifyMailboxCheck({ fetched: 0 }, { announceIdle: false });

    await waitFor(() => {
      expect(screen.queryByText('No new mail')).not.toBeInTheDocument();
    });
  });

  it('reports an unreachable mailbox even in the background', async () => {
    render(<NotificationHost />);

    notifyMailboxCheck({ fetched: 0, error: 'IMAP refused' }, { announceIdle: false });

    await screen.findByText('Could not check the IPC mailbox');
  });
});

describe('failures that used to be invisible', () => {
  it('warns when the session has expired', async () => {
    render(<NotificationHost />);

    axiosClient.defaults.adapter = async (config) => {
      const error = new Error('Unauthorized');
      error.config = config;
      error.response = { status: 401, data: {} };
      throw error;
    };

    await expect(axiosClient.get('/queries')).rejects.toThrow();

    await screen.findByText('Your session has expired');
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it('reports a server that never answered', async () => {
    render(<NotificationHost />);

    axiosClient.defaults.adapter = async (config) => {
      const error = new Error('Network Error');
      error.config = config;
      throw error;
    };

    await expect(axiosClient.get('/queries')).rejects.toThrow();
    await screen.findByText('Cannot reach the server');
  });

  it('warns when the AI draft silently fell back to a template', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);
    act(() => s().assignQuery(queryId, OFFICIAL.id, OIC));

    await s().generateAiDraft(queryId, OFFICIAL, async () => null);

    await screen.findByText('AI assistant unavailable');
  });

  it('stays quiet when the AI actually produced the draft', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);
    act(() => s().assignQuery(queryId, OFFICIAL.id, OIC));

    await s().generateAiDraft(queryId, OFFICIAL, async () => ({
      subject: 'Response regarding endotoxin limits',
      paragraphs: ['A genuine model-written reply about endotoxin limits.'],
    }));

    await screen.findByText('Draft response generated');
    expect(screen.queryByText('AI assistant unavailable')).not.toBeInTheDocument();
  });

  it('reports a workflow action that threw, and stays quiet when it did not', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useWorkflowAction } = await import('@/hooks/useWorkflowAction');

    render(<NotificationHost />);
    const { result } = renderHook(() => useWorkflowAction());

    await act(async () => {
      await result.current.run(async () => {});
    });
    expect(screen.queryByText('Action could not be completed')).not.toBeInTheDocument();

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('Missing attachment(s): report.pdf');
      });
    });
    await screen.findByText('Action could not be completed');
    await screen.findByText('Missing attachment(s): report.pdf');
  });

  it('reports a failure to save locally', async () => {
    render(<NotificationHost />);

    useWorkflowStore.setState({ persistenceError: 'QuotaExceededError' });

    await screen.findByText('Could not save your work locally');
  });
});
