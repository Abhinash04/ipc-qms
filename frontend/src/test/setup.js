import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no ResizeObserver, and Radix ScrollArea constructs one. Layout is
// never asserted here, so a no-op is enough to let those components mount.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock('@/services/api/aiService', () => ({
  fetchGemmaAiSummary: async () => null,
  fetchGemmaAiRecommendations: async () => null,
  fetchGemmaAiDraft: async () => null,
}));

/**
 * The workflow store persists through a real HTTP API, and must never reach one
 * from a test.
 *
 * Left unmocked the suite talks to whatever backend is running on localhost —
 * and because many suites call `resetDemo()` in `beforeEach`, that means
 * POSTing to /queries/reset, which `deleteMany()`s every collection in the
 * developer's own database. (Aakash's warning, from origin/aakash 5539f7b.)
 *
 * His fix rejected every call. This replaces the module with an in-memory fake
 * instead, so persistence round-trips are exercised rather than short-
 * circuited: the store's accept and final-approval paths re-read the server
 * after acting, and a rejecting stub would fail every test that covers them.
 * Either way nothing leaves the process — see src/test/fakeQueryApi.js.
 */
vi.mock('@/services/api/queryCaseService', () => import('@/test/fakeQueryApi'));

let consoleError;
let consoleWarn;
const captured = [];

beforeEach(async () => {
  /**
   * Let the previous test's writes land before clearing.
   *
   * `applyTransition` does not await `persistDelta` — the UI must not wait on
   * the network — so a test can finish with writes still queued. `loadAll` is
   * queued behind them (see services/persistence/queryState.js), so awaiting it
   * drains the queue; clearing first would let those writes arrive *after* the
   * reset and appear in the next test's state.
   */
  const { loadAll } = await import('@/services/persistence/queryState');
  await loadAll().catch(() => {});

  const { __resetFakeQueryApi } = await import('@/test/fakeQueryApi');
  __resetFakeQueryApi();
  captured.length = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    captured.push(['error', ...args]);
  });
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    captured.push(['warn', ...args]);
  });
});

afterEach(() => {
  cleanup();
  const messages = captured.map(([level, ...args]) => `[${level}] ${args.join(' ')}`);
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(messages, `Unexpected console output:\n${messages.join('\n')}`).toEqual([]);
});

