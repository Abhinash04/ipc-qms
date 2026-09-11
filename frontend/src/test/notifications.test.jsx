import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { NotificationHost } from '@/components/notifications/NotificationHost';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { axiosClient } from '@/services/api/axiosClient';
import { notify, beginBatch, endBatch } from '@/services/notify';
import { notifyIngestResult } from '@/hooks/useMailboxIngestion';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import * as mailboxService from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService');

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');

const s = () => useWorkflowStore.getState();

const ACK_RESULT = {
  from: 'Front Office <front@ipc.example>',
  to: [INQUIRER.email],
  subject: 'Acknowledgement of Query Received',
  body: 'Received.',
  sentAt: '2026-08-26T10:00:00.000Z',
  providerMessageId: 'ack-1',
};

const FORWARD_RESULT = {
  from: 'Front Office <front@ipc.example>',
  to: [OIC.email],
  subject: 'Fwd: enquiry',
  body: 'forwarded',
  sentAt: '2026-08-26T10:05:00.000Z',
  providerMessageId: 'fwd-1',
  providerThreadId: 'thread-fo',
};

const enquiry = (id = 'MSG-NOTIF-0001') => ({
  mailboxMessageId: id,
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Endotoxin limits clarification',
  body: 'Please clarify.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const received = (id) => s().ingestEmail(enquiry(id), async () => null).queryId;

/** A committed forward requires the query to be verified first. */
const verified = async (queryId) => {
  await s().verifyQuery(queryId, FRONT_OFFICE);
};

const originalAdapter = axiosClient.defaults.adapter;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({});
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK_RESULT);
  vi.mocked(mailboxService.forwardQuery).mockResolvedValue(FORWARD_RESULT);

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
    vi.mocked(mailboxService.forwardQuery).mockRejectedValue(new Error('SMTP down'));
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await expect(s().forwardToOic(queryId, FRONT_OFFICE)).rejects.toThrow(/SMTP down/);

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
    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(
      s().getAudit(queryId).some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED),
    ).toBe(true);
    await screen.findByText('Forwarded to the Officer-in-Charge');
  });

  it('says nothing for events that are audited but deliberately silent', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await s().forwardToOic(queryId, FRONT_OFFICE);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    await screen.findByText('Query assigned');

    s().saveDraftVersion(queryId, 'A revised draft body.', OFFICIAL);

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
    await s().forwardToOic(queryId, FRONT_OFFICE);
    await screen.findByText('Forwarded to the Officer-in-Charge');

    await s().resetDemo();
    expect(s().auditEvents).toHaveLength(0);

    // The subscriber survives the reset without mistaking the shrink for
    // activity, and a genuinely new transition still announces itself once.
    const next = received('MSG-NOTIF-0002');
    await verified(next);
    await s().forwardToOic(next, FRONT_OFFICE);
    s().assignQuery(next, OFFICIAL.id, OIC);

    await screen.findByText('Query assigned');
    expect(screen.getAllByText('Query assigned')).toHaveLength(1);
  });

  it('emits nothing for the events already present when it mounts', async () => {
    const queryId = received();
    await verified(queryId);
    await s().forwardToOic(queryId, FRONT_OFFICE);

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
      await s().forwardToOic(queryId, FRONT_OFFICE);
    } finally {
      endBatch();
    }

    // The transitions committed and were audited...
    expect(s().auditEvents.some((e) => e.event === AUDIT_EVENT.QUERY_FORWARDED)).toBe(true);
    // ...but the user sees the single summary instead of three toasts.
    expect(
      screen.queryByText('Forwarded to the Officer-in-Charge'),
    ).not.toBeInTheDocument();

    notifyIngestResult({
      created: ['QRY-1'],
      skipped: [],
      acknowledged: ['QRY-1'],
      forwarded: ['QRY-1'],
    });
    await screen.findByText('1 new case registered');
  });

  it('stays quiet when a background poll finds nothing', async () => {
    render(<NotificationHost />);

    notifyIngestResult(
      { created: [], skipped: [], acknowledged: [], forwarded: [] },
      { announceIdle: false },
    );

    await waitFor(() => {
      expect(screen.queryByText('No new mail')).not.toBeInTheDocument();
    });
  });

  it('reports an unreachable mailbox even in the background', async () => {
    render(<NotificationHost />);

    notifyIngestResult(
      { created: [], skipped: [], acknowledged: [], forwarded: [], error: 'IMAP refused' },
      { announceIdle: false },
    );

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
    await s().forwardToOic(queryId, FRONT_OFFICE);
    s().assignQuery(queryId, OFFICIAL.id, OIC);

    await s().generateAiDraft(queryId, OFFICIAL, async () => null);

    await screen.findByText('AI assistant unavailable');
  });

  it('stays quiet when the AI actually produced the draft', async () => {
    render(<NotificationHost />);

    const queryId = received();
    await verified(queryId);
    await s().forwardToOic(queryId, FRONT_OFFICE);
    s().assignQuery(queryId, OFFICIAL.id, OIC);

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
