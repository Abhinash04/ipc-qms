import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The timer around the sweep.
 *
 * A background job that can hold the process open, run twice at once, or die
 * silently on one bad pass is worse than no job at all, so those are what these
 * assert. The sweep is stubbed out: what is under test here is the scheduling.
 */

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => false,
}));

import env from '../config/env.js';
import { startRetentionSweeps, stopRetentionSweeps } from '../services/email/mailbox/retention.js';

const ORIGINAL = { nodeEnv: env.NODE_ENV, enabled: env.MAILBOX_RETENTION_ENABLED };

beforeEach(() => {
  vi.useFakeTimers();
  stopRetentionSweeps();
});

afterEach(() => {
  stopRetentionSweeps();
  vi.useRealTimers();
  env.NODE_ENV = ORIGINAL.nodeEnv;
  env.MAILBOX_RETENTION_ENABLED = ORIGINAL.enabled;
});

describe('when the sweep is not wanted', () => {
  it('registers nothing under NODE_ENV=test', () => {
    // The suite has no MongoDB and the in-memory stand-in makes index
    // behaviour invisible anyway. A timer here would only make tests flaky.
    env.NODE_ENV = 'test';
    expect(startRetentionSweeps()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers nothing when retention is switched off', () => {
    env.NODE_ENV = 'production';
    env.MAILBOX_RETENTION_ENABLED = false;
    expect(startRetentionSweeps()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('when the sweep is wanted', () => {
  beforeEach(() => {
    env.NODE_ENV = 'production';
    env.MAILBOX_RETENTION_ENABLED = true;
  });

  it('never holds the process open', () => {
    // An unref'd timer is the difference between a clean exit and a server
    // that will not shut down.
    const timer = startRetentionSweeps({ bootedAt: Date.now() });
    expect(timer.hasRef()).toBe(false);
  });

  it('schedules an early first pass as well as the hourly one', () => {
    // The first interval tick is an hour away. A deployment restarted more
    // often than that would otherwise never sweep at all.
    startRetentionSweeps({ bootedAt: Date.now() });
    expect(vi.getTimerCount()).toBe(2);
  });

  it('is idempotent — starting twice leaves one interval', () => {
    const first = startRetentionSweeps({ bootedAt: Date.now() });
    const second = startRetentionSweeps({ bootedAt: Date.now() });
    expect(second).toBe(first);
  });

  it('clears both timers on stop', () => {
    startRetentionSweeps({ bootedAt: Date.now() });
    stopRetentionSweeps();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps ticking rather than dying on a pass that went wrong', async () => {
    // isConnected() is false here, so every sweep returns early. The point is
    // that the timer survives and the ticks keep coming.
    startRetentionSweeps({ bootedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});
