import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { MailboxAutoSync } from '@/components/workflow/MailboxAutoSync';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { notify } from '@/services/notify';
import * as mailboxService from '@/services/api/mailboxService';

vi.mock('@/services/api/mailboxService');

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');

const POLL_MS = 30000;
const BACKOFF_MS = [60000, 120000, 300000];

/** What a mailbox the server could not reach rejects with. */
const unreachable = (reason = 'Gmail mailbox unreachable (getaddrinfo ENOTFOUND gmail.googleapis.com)') =>
  Object.assign(new Error('Request failed with status code 503'), {
    response: { status: 503, data: { error: reason, retryable: true } },
  });

let toasts;

/**
 * Advance the fake clock past one poll and let the request that follows settle.
 *
 * The tick is `setTimeout` → `await checkMailbox()` → `setTimeout`, so the
 * timer alone does not run the whole thing: the promise in the middle has to
 * be flushed before the next timer exists.
 */
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
  // Dropped rather than run: the next tick is always scheduled, and firing it
  // here would update React outside `act` and fail the shared console check.
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A mailbox that cannot be reached is an outage, not a stream of events.
 *
 * The live Gmail test produced one permanent "Could not check the IPC mailbox"
 * toast every thirty seconds for as long as the DNS failure lasted, because an
 * error toast stays until it is dismissed and every poll raised another. The
 * failure still has to be visible — silently not reading the mailbox is worse —
 * so it is announced once, and again when it clears.
 */
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
    // And it carries the server's reason, not "Request failed with status code 503".
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

    // The ordinary interval has passed, but the backoff has not.
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

  /**
   * A mailbox the server reached but could not READ answers 200, with the last
   * stored listing and a `sync` saying why — which is what a NICeMail browser
   * agent with no Chrome behind it looks like. This poll used to treat that as
   * a healthy empty mailbox and say nothing at all, on every page but the inbox.
   */
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

/**
 * The same restraint for the good news. "3 messages awaiting validation" every
 * thirty seconds for the same three messages is noise; a fourth arriving is
 * not.
 */
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

  // The poll needs a count, not the mailbox: one row and the server's `total`.
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
