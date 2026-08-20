import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * The Gemma AI client talks to the backend, which does not exist under test.
 * Left real it would reject on every ingestion, log a warning, and fail the
 * console assertion below — so the default is inert here.
 *
 * This is the *default* only. `ingestEmail` takes the fetcher as an injected
 * parameter, so a test that wants to assert Gemma behaviour passes its own
 * stub and gets it, exactly like the `send` / `forward` / `client` seams.
 */
vi.mock('@/services/api/aiService', () => ({
  fetchGemmaAiSummary: async () => null,
  fetchGemmaAiRecommendations: async () => null,
}));

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
