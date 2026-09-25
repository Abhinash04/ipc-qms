import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { MailboxAutoSync } from '@/components/workflow/MailboxAutoSync';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { notify } from '@/services/notify';
import * as mailboxService from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService');

const OIC = findUserById('USR-0003');

const POLL_MS = 30000;
const BACKOFF_MS = [60000, 120000, 300000];

const unreachable = (reason = 'Mailbox unreachable (getaddrinfo ENOTFOUND mail.mgovcloud.in)') =>
  Object.assign(new Error('Request failed with status code 503'), {
    response: { status: 503, data: { error: reason, retryable: true } },
  });

let toasts;

async function poll(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  toasts = {
    error: vi.spyOn(notify, 'error').mockImplementation(() => {}),
    info: vi.spyOn(notify, 'info').mockImplementation(() => {}),
    dismiss: vi.spyOn(notify, 'dismiss').mockImplementation(() => {}),
  };
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('an unreachable mailbox is announced once, not once per poll', () => {
  it('raises a single toast however long the outage lasts', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(unreachable());
    render(<MailboxAutoSync />);

    await poll(POLL_MS);
    await poll(BACKOFF_MS[0]);
    await poll(BACKOFF_MS[1]);
    await poll(BACKOFF_MS[2]);

    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(4);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(
      'The IPC mailbox cannot be reached',
      expect.stringContaining('ENOTFOUND'),
      { id: 'mailbox-unreachable' },
    );
  });

  it('asks less often while it is failing, rather than every thirty seconds', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(unreachable());
    render(<MailboxAutoSync />);

    await poll(POLL_MS);
    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(1);

    await poll(POLL_MS);
    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(1);

    await poll(POLL_MS);
    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(2);
  });

  it('dismisses the toast and says so when the mailbox comes back', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(unreachable());
    render(<MailboxAutoSync />);
    await poll(POLL_MS);

    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
    await poll(BACKOFF_MS[0]);

    expect(toasts.dismiss).toHaveBeenCalledWith('mailbox-unreachable');
    expect(toasts.info).toHaveBeenCalledWith('The IPC mailbox is reachable again', undefined, {
      id: 'mailbox-recovered',
    });
  });

  it('announces a mailbox that answered but could not be read', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({
      messages: [],
      sync: { ok: false, error: 'Chrome is not available for browser automation.' },
    });
    render(<MailboxAutoSync />);

    await poll(POLL_MS);

    expect(toasts.error).toHaveBeenCalledWith(
      'The IPC mailbox cannot be reached',
      'Chrome is not available for browser automation.',
      { id: 'mailbox-unreachable' },
    );
  });

  it('announces a second outage after a recovery', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(unreachable());
    render(<MailboxAutoSync />);
    await poll(POLL_MS);

    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
    await poll(BACKOFF_MS[0]);

    vi.mocked(mailboxService.fetchMailboxMessages).mockRejectedValue(unreachable());
    await poll(POLL_MS);

    expect(toasts.error).toHaveBeenCalledTimes(2);
  });
});

describe('waiting mail is announced when it grows, not while it sits', () => {
  const waiting = (n) => ({ messages: Array.from({ length: n }, (_, i) => ({ mailboxMessageId: `m${i}` })) });

  it('says nothing the second time the same mail is still waiting', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue(waiting(2));
    render(<MailboxAutoSync />);

    await poll(POLL_MS);
    await poll(POLL_MS);
    await poll(POLL_MS);

    expect(toasts.info).toHaveBeenCalledTimes(1);
    expect(toasts.info).toHaveBeenCalledWith(
      '2 messages awaiting validation',
      'Open the IPC mailbox to accept or reject them.',
      { id: 'mailbox-waiting' },
    );
  });

  it('speaks again when more mail arrives', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue(waiting(1));
    render(<MailboxAutoSync />);
    await poll(POLL_MS);

    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue(waiting(3));
    await poll(POLL_MS);

    expect(toasts.info).toHaveBeenNthCalledWith(
      1,
      '1 message awaiting validation',
      expect.any(String),
      { id: 'mailbox-waiting' },
    );
    expect(toasts.info).toHaveBeenNthCalledWith(
      2,
      '3 messages awaiting validation',
      expect.any(String),
      { id: 'mailbox-waiting' },
    );
  });

  it('asks for one row and announces the total', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({
      messages: [{ mailboxMessageId: 'm0' }],
      total: 7,
      limit: 1,
      offset: 0,
    });
    render(<MailboxAutoSync />);

    await poll(POLL_MS);

    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledWith({ unreadOnly: true, limit: 1 });
    expect(toasts.info).toHaveBeenCalledWith(
      '7 messages awaiting validation',
      'Open the IPC mailbox to accept or reject them.',
      { id: 'mailbox-waiting' },
    );
  });

  it('stays quiet for an empty mailbox', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
    render(<MailboxAutoSync />);

    await poll(POLL_MS);
    await poll(POLL_MS);

    expect(toasts.info).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('nobody else polls the mailbox', () => {
  it('does nothing at all for a role that is not Front Office', async () => {
    useAuthStore.setState({ currentUser: OIC, authReady: true });
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });

    render(<MailboxAutoSync />);
    await poll(POLL_MS);
    await poll(POLL_MS);

    expect(mailboxService.fetchMailboxMessages).not.toHaveBeenCalled();
  });

  it('stops polling once it unmounts', async () => {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
    const { unmount } = render(<MailboxAutoSync />);

    await poll(POLL_MS);
    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(1);

    unmount();
    await poll(POLL_MS);
    expect(mailboxService.fetchMailboxMessages).toHaveBeenCalledTimes(1);
  });
});
