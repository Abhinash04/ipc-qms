import { describe, it, expect } from 'vitest';

import { parseSender, formatReceived, formatFullDate, toSnippet } from '@/utils/mailboxFormat';

describe('mailbox formatting', () => {
  it('splits a sender into name, address and initials', () => {
    expect(parseSender('Ravi Kumar <ravi@pharma.example>')).toEqual({
      name: 'Ravi Kumar',
      email: 'ravi@pharma.example',
      initials: 'RK',
    });
  });

  it('shows a missing or unreadable date as unknown, never as now', () => {
    expect(formatReceived(null)).toEqual({ date: '—', time: '' });
    expect(formatReceived('not a date')).toEqual({ date: '—', time: '' });
    expect(formatFullDate(undefined)).toBe('—');
  });

  it('collapses a body onto one line and cuts it at 140 characters', () => {
    expect(toSnippet('Dear team,\n\n  please   confirm.')).toBe('Dear team, please confirm.');
    const snippet = toSnippet('word '.repeat(60));
    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet.endsWith('…')).toBe(true);
    expect(toSnippet(null)).toBe('');
  });
});
