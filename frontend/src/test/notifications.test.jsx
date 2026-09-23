import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { axiosClient } from '@/services/api/axiosClient';
import { notify, beginBatch, endBatch } from '@/services/notify';
import { notifyMailboxCheck } from '@/hooks/useMailboxIngestion';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import * as mailboxService from '@/services/api/mailboxService';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');

const s = () => useWorkflowStore.getState();

/**
 * The acknowledgement and the forward are server calls. A toast follows what
 * the server did with the case, so these tests need a server that does it —
 * a canned reply would leave the case where it was and the toast would be
 * announcing nothing. See src/test/fakeCaseMail.js.
 */

const enquiry = (id = 'MSG-NOTIF-0001') => ({
  mailboxMessageId: id,
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Endotoxin limits clarification',
  body: 'Please clarify.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const received = (id) => s().ingestEmail(enquiry(id), async () => null).queryId;

/**
 * A committed forward requires the query to be verified first.
 *
 * Both of these reach the server and come back through `refreshFromServer()`,
 * which is a React state update — so they are wrapped in `act`. Without it the
 * toast arrives after the assertion, and React says so on the console, which
 * the shared setup treats as a failure.
 */
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

  // Toasts queued by a previous test would otherwise appear as soon as the
  // next Toaster mounts.
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

    // Nothing was committed, so nothing may be announced. A toast wired to the
    // button rather than the operation would have fired here.
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

    // DRAFT_UPDATED is recorded but never toasted — the audit trail keeps it.
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

    // The subscriber survives the reset without mistaking the shrink for
    // activity, and a genuinely new transition still announces itself once.
    const next = received('MSG-NOTIF-0002');
    await verified(next);
    await forwarded(next);
    act(() => s().assignQuery(next, OFFICIAL.id, OIC));

    await screen.findByText('Query assigned');
    expect(screen.getAllByText('Query assigned')).toHaveLength(1);
  });

  it('emits nothing for the events already present when it mounts', async () => {
    const queryId = received();
    await verified(queryId);
    await forwarded(queryId);

    // Mounting after the fact must not announce what already happened.
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

    // The transitions committed and were audited...
    expect(s().auditEvents.some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED)).toBe(true);
    // ...but the user sees the single summary instead of three toasts.
    expect(
      screen.queryByText('Forwarded to the Officer-in-Charge'),
    ).not.toBeInTheDocument();

    notifyMailboxCheck({ fetched: 1 });
    await screen.findByText('1 message awaiting validation');
  });

  it('reports mail as waiting, never as registered', async () => {
    render(<NotificationHost />);

    // The background poll used to register everything it found and announce
    // "N new cases registered". It now only counts what is waiting — a timer
    // must not open a case on somebody's behalf.
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
