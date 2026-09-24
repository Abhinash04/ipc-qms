import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The timer that reads the NICeMail mailbox without anyone signed in.
 *
 * Two things are under test and neither is the sync itself: the scheduling —
 * which must not hold the process open, run twice at once, or die on a bad tick —
 * and the breaker, which is the only thing standing between a closed Chrome and
 * one CDP probe every fifteen seconds forever.
 *
 * The store is mocked, so `syncIfDue` is observable and no browser is involved.
 */

const syncIfDue = vi.fn();
let status = { ok: null };

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));

vi.mock('../services/email/mailbox/nicBrowserMailbox.js', () => ({
  SOURCE: 'nic-browser',
  syncIfDue,
  syncStatus: () => status,
}));

import env from '../config/env.js';
import browserConfig from '../config/browserConfig.js';
import {
  startMailboxSync,
  stopMailboxSync,
  tickOnce,
  syncSchedulerState,
  resetSyncScheduler,
} from '../services/email/mailbox/syncScheduler.js';

const ORIGINAL = {
  nodeEnv: env.NODE_ENV,
  enabled: env.MAILBOX_SYNC_ENABLED,
  interval: env.MAILBOX_SYNC_INTERVAL_MS,
};

beforeEach(() => {
  vi.useFakeTimers();
  resetSyncScheduler();
  syncIfDue.mockClear();
  status = { ok: null };
  vi.stubEnv('NIC_BROWSER_MAILBOX', 'true');
  vi.stubEnv('NIC_EMAIL', 'nic@ipc.invalid');
  env.MAILBOX_SYNC_INTERVAL_MS = 15000;
});

afterEach(() => {
  resetSyncScheduler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  env.NODE_ENV = ORIGINAL.nodeEnv;
  env.MAILBOX_SYNC_ENABLED = ORIGINAL.enabled;
  env.MAILBOX_SYNC_INTERVAL_MS = ORIGINAL.interval;
});

describe('when the timer is not wanted', () => {
  it('registers nothing under NODE_ENV=test', () => {
    // The suite has no Chrome, and NIC_CDP_ENDPOINT is pinned unroutable. A
    // timer here would reach for a browser on every tick.
    env.NODE_ENV = 'test';
    expect(startMailboxSync()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers nothing when the sync timer is switched off', () => {
    env.NODE_ENV = 'production';
    env.MAILBOX_SYNC_ENABLED = false;
    expect(startMailboxSync()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the timer', () => {
  beforeEach(() => {
    env.NODE_ENV = 'production';
    env.MAILBOX_SYNC_ENABLED = true;
  });

  it('never holds the process open', () => {
    expect(startMailboxSync().hasRef()).toBe(false);
  });

  it('is idempotent — starting twice leaves one timer', () => {
    const first = startMailboxSync();
    expect(startMailboxSync()).toBe(first);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears the timer on stop', () => {
    startMailboxSync();
    stopMailboxSync();
    expect(vi.getTimerCount()).toBe(0);
    expect(syncSchedulerState().running).toBe(false);
  });

  it('asks for a sync on every interval', async () => {
    startMailboxSync();
    await vi.advanceTimersByTimeAsync(15000);
    expect(syncIfDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(syncIfDue).toHaveBeenCalledTimes(2);
  });

  it('keeps ticking rather than dying on a tick that went wrong', async () => {
    syncIfDue.mockImplementationOnce(() => {
      throw new Error('store blew up');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    startMailboxSync();
    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(60000);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(syncIfDue.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops asking once stopped, rather than one tick later', async () => {
    startMailboxSync();
    await vi.advanceTimersByTimeAsync(15000);
    stopMailboxSync();
    await vi.advanceTimersByTimeAsync(120000);
    expect(syncIfDue).toHaveBeenCalledTimes(1);
  });
});

describe('what the tick declines to do', () => {
  it('does nothing when the browser mailbox is off', async () => {
    vi.stubEnv('NIC_BROWSER_MAILBOX', '');
    expect(browserConfig.mailboxEnabled).toBe(false);

    const result = await tickOnce();

    expect(result.ran).toBe(false);
    expect(result.declined).toMatch(/browser mailbox is off/);
    expect(syncIfDue).not.toHaveBeenCalled();
  });

  it('does nothing when NIC_EMAIL is not set', async () => {
    vi.stubEnv('NIC_EMAIL', '');
    const result = await tickOnce();
    expect(result.ran).toBe(false);
    expect(result.declined).toMatch(/NIC_EMAIL/);
    expect(syncIfDue).not.toHaveBeenCalled();
  });

  it('never loads the store module just to decline', async () => {
    // nicBrowserMailbox may only be imported on demand. Declining before the
    // import is what keeps that true for a timer that fires forever.
    vi.stubEnv('NIC_BROWSER_MAILBOX', '');
    await tickOnce();
    expect(syncIfDue).not.toHaveBeenCalled();
  });

  it('passes the configured mailbox address, never a caller-supplied one', async () => {
    await tickOnce();
    expect(syncIfDue).toHaveBeenCalledWith('nic@ipc.invalid');
  });
});

describe('the breaker', () => {
  it('runs at the interval while syncs are succeeding', async () => {
    status = { ok: true };
    await tickOnce();
    expect(syncSchedulerState()).toMatchObject({ failures: 0, delayMs: 15000 });
  });

  it('treats a never-attempted status as neither success nor failure', async () => {
    status = { ok: null };
    await tickOnce();
    expect(syncSchedulerState().failures).toBe(0);
  });

  it('backs off further on each consecutive failure', async () => {
    // 1x, 2x, 4x, 20x the interval. Without this a closed Chrome is probed
    // every fifteen seconds forever, each probe paying a fetch plus the CDP
    // timeout.
    status = { ok: false, stage: 'connect_browser' };

    await tickOnce();
    expect(syncSchedulerState().delayMs).toBe(15000);
    await tickOnce();
    expect(syncSchedulerState().delayMs).toBe(30000);
    await tickOnce();
    expect(syncSchedulerState().delayMs).toBe(60000);
    await tickOnce();
    expect(syncSchedulerState().delayMs).toBe(300000);
  });

  it('stops backing off further once it reaches the longest step', async () => {
    status = { ok: false };
    for (let i = 0; i < 10; i += 1) await tickOnce();
    expect(syncSchedulerState()).toMatchObject({ failures: 4, delayMs: 300000 });
  });

  it('recovers to the interval as soon as one sync succeeds', async () => {
    status = { ok: false };
    await tickOnce();
    await tickOnce();
    expect(syncSchedulerState().delayMs).toBeGreaterThan(15000);

    status = { ok: true };
    await tickOnce();
    expect(syncSchedulerState()).toMatchObject({ failures: 0, delayMs: 15000 });
  });

  it('keeps asking even while backed off, so a recovery is noticed', async () => {
    status = { ok: false };
    await tickOnce();
    await tickOnce();
    expect(syncIfDue).toHaveBeenCalledTimes(2);
  });

  it('scales with the configured interval rather than hard-coded delays', async () => {
    env.MAILBOX_SYNC_INTERVAL_MS = 30000;
    status = { ok: false };
    await tickOnce();
    await tickOnce();
    expect(syncSchedulerState().delayMs).toBe(60000);
  });

  it('starts every run with the breaker clear', async () => {
    status = { ok: false };
    await tickOnce();
    await tickOnce();
    env.NODE_ENV = 'production';
    startMailboxSync();
    expect(syncSchedulerState().failures).toBe(0);
  });
});
