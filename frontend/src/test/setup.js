import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Fail any test that logs a console error or warning.
 *
 * This is the point of the suite: React reports the "getSnapshot should be
 * cached" infinite-loop bug as a console error *before* it escalates to a
 * thrown exception, and a plain "did it render" assertion would pass right up
 * until the render depth limit is hit. Treating console noise as a failure is
 * what makes these smoke tests actually catch unstable-selector regressions.
 */
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
