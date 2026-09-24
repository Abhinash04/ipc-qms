import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

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

vi.mock('@/services/api/queryCaseService', () => import('@/test/fakeQueryApi'));

let consoleError;
let consoleWarn;
const captured = [];

beforeEach(async () => {
  const { loadAll } = await import('@/services/persistence/queryState');
  await loadAll().catch(() => {});
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

