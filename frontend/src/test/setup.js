import 'fake-indexeddb/auto';
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
 * Query cases are persisted through a real HTTP API. Left unmocked the suite
 * talks to whatever backend happens to be running on localhost — and because
 * many suites call resetDemo() in beforeEach, that means POSTing to
 * /queries/reset, which deleteMany()s every collection in the developer's
 * database. Rejecting here puts db.js on the in-memory fallback every one of
 * its callers already handles, which is the behaviour these tests were written
 * against.
 */
vi.mock('@/services/api/queryCaseService', () => {
  const offline = () => Promise.reject(new Error('query API disabled in tests'));
  return {
    fetchAllQueries: offline,
    checkQueriesEmpty: offline,
    persistQueryTransition: offline,
    resetQueries: offline,
  };
});

let consoleError;
let consoleWarn;
const captured = [];

beforeEach(() => {
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

