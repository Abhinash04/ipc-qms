import { describe, it, expect } from 'vitest';

import {
  IPC_CONTEXT_ENTRIES,
  selectContext,
  formatContextForPrompt,
} from '../data/ipcContextBrain.js';

describe('the IPC glossary is well formed', () => {
  it('has entries', () => {
    expect(IPC_CONTEXT_ENTRIES.length).toBeGreaterThan(30);
  });

  it('gives every entry an id, term, category, definition and a named source', () => {
    for (const entry of IPC_CONTEXT_ENTRIES) {
      expect(entry.id, JSON.stringify(entry).slice(0, 100)).toBeTruthy();
      expect(entry.term).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.definition.length).toBeGreaterThan(20);
      expect(entry.source?.name).toBeTruthy();
      expect(typeof entry.verified).toBe('boolean');
    }
  });

  it('has unique ids', () => {
    const ids = IPC_CONTEXT_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('selectContext', () => {
  it('matches on the term itself', () => {
    const ids = selectContext('a question about the dissolution test').map((entry) => entry.id);
    expect(ids).toContain('DISSOLUTION');
  });

  it('matches on an alias', () => {
    const ids = selectContext('we need a reference substance for this assay').map((e) => e.id);
    expect(ids).toContain('IPRS');
  });

  it('is case insensitive', () => {
    expect(selectContext('IPRS').map((e) => e.id)).toContain('IPRS');
    expect(selectContext('iprs').map((e) => e.id)).toContain('IPRS');
  });

  it('surfaces the entry that stops the model claiming IPC approves drugs', () => {
    const ids = selectContext('does IPC handle drug approval and marketing authorisation?').map(
      (e) => e.id,
    );
    expect(ids).toContain('IPC_NOT_A_REGULATOR');
  });

  it('respects the limit', () => {
    const selected = selectContext('monograph impurity dissolution assay batch', { limit: 2 });
    expect(selected).toHaveLength(2);
  });

  it('returns nothing for unrelated text', () => {
    expect(selectContext('zxqw blorptang')).toEqual([]);
    expect(selectContext('')).toEqual([]);
  });
});

describe('formatContextForPrompt', () => {
  it('renders term, category, definition and source', () => {
    const [entry] = selectContext('dissolution');
    const formatted = formatContextForPrompt([entry]);
    expect(formatted).toContain(entry.term);
    expect(formatted).toContain(entry.category);
    expect(formatted).toContain(entry.source.name);
  });

  it('flags an unverified entry so the model cannot treat it as authoritative', () => {
    const unverified = IPC_CONTEXT_ENTRIES.find((entry) => entry.verified === false);
    expect(formatContextForPrompt([unverified])).toContain('UNVERIFIED');
  });

  it('says so plainly when nothing matched', () => {
    expect(formatContextForPrompt([])).toContain('No IPC glossary entry matched');
  });
});
