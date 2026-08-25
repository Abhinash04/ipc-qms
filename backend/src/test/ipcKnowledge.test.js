import { describe, it, expect } from 'vitest';

import {
  IPC_KNOWLEDGE_CHUNKS,
  IPC_KNOWLEDGE_MANIFEST,
  retrieveContext,
  formatPassagesForPrompt,
} from '../data/ipcKnowledge.js';
import { EXCLUDED_DOCS } from '../data/ipcDocs.manifest.js';

describe('the committed knowledge base is well formed', () => {
  it('has chunks', () => {
    expect(IPC_KNOWLEDGE_CHUNKS.length).toBeGreaterThan(100);
  });

  it('gives every chunk an id, a document, text and a traceable source', () => {
    for (const chunk of IPC_KNOWLEDGE_CHUNKS) {
      expect(chunk.id, JSON.stringify(chunk).slice(0, 120)).toBeTruthy();
      expect(chunk.docId).toBeTruthy();
      expect(chunk.docTitle).toBeTruthy();
      expect(chunk.text.trim().length).toBeGreaterThan(0);
      expect(chunk.source.file).toBeTruthy();
      expect(chunk.source.publisher).toBe('Indian Pharmacopoeia Commission');
      expect(chunk.source.repository).toContain('ipc.gov.in');
    }
  });

  it('has unique chunk ids', () => {
    const ids = IPC_KNOWLEDGE_CHUNKS.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains nothing from an excluded document', () => {
    const excluded = new Set(EXCLUDED_DOCS.map((doc) => doc.file));
    for (const chunk of IPC_KNOWLEDGE_CHUNKS) {
      expect(excluded.has(chunk.source.file), `${chunk.id} came from ${chunk.source.file}`).toBe(
        false,
      );
    }
  });

  it('records every exclusion with a reason', () => {
    expect(IPC_KNOWLEDGE_MANIFEST.skipped.length).toBeGreaterThanOrEqual(EXCLUDED_DOCS.length);
    for (const entry of IPC_KNOWLEDGE_MANIFEST.skipped) {
      expect(entry.file).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('carries no raw tab, so no chunk was split by a mangled LaTeX escape', () => {
    const withTab = IPC_KNOWLEDGE_CHUNKS.filter((chunk) => chunk.text.includes('\t'));
    expect(withTab.map((chunk) => chunk.id)).toEqual([]);
  });

  it('carries no guidance-document disclaimer boilerplate', () => {
    const withDisclaimer = IPC_KNOWLEDGE_CHUNKS.filter((chunk) =>
      chunk.text.includes('This Guidance Document is compiled by'),
    );
    expect(withDisclaimer.map((chunk) => chunk.id)).toEqual([]);
  });

  it('carries no personal-name roster', () => {
    const rosterNames = ['Sihorwala', 'Wockhardt', 'Mohan Jain', 'Padmaja'];
    for (const name of rosterNames) {
      const hits = IPC_KNOWLEDGE_CHUNKS.filter((chunk) => chunk.text.includes(name));
      expect(hits.map((chunk) => chunk.id), `roster name ${name} leaked`).toEqual([]);
    }
  });

  it('keeps the Expert Working Group taxonomy', () => {
    const ewg = IPC_KNOWLEDGE_CHUNKS.find((chunk) => chunk.docId === 'EWG');
    expect(ewg.text).toContain('Excipients');
    expect(ewg.text).toContain('Medical Devices');
  });

  it('stamps every amendment chunk with its amendment list', () => {
    const amendments = IPC_KNOWLEDGE_CHUNKS.filter((chunk) => chunk.kind === 'AMENDMENT');
    expect(amendments.length).toBeGreaterThan(0);
    for (const chunk of amendments) {
      expect(chunk.amendmentList, chunk.id).toMatch(/^Amendment List-\d\d$/);
    }
  });
});

describe('retrieveContext returns only relevant passages', () => {
  it('finds the legal-status answer', () => {
    const hits = retrieveContext('What is the legal status of the Indian Pharmacopoeia?');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((chunk) => /legal status/i.test(chunk.section))).toBe(true);
  });

  it('finds the drug-approval answer', () => {
    const hits = retrieveContext('Does the IPC approve drugs or grant marketing authorisation?');
    expect(hits.some((chunk) => /drug approval/i.test(chunk.section))).toBe(true);
  });

  it('finds the alternative-methods clarification', () => {
    const hits = retrieveContext(
      'Can we apply an alternative analytical procedure instead of the official IP method?',
    );
    expect(hits.some((chunk) => /alternative/i.test(chunk.section))).toBe(true);
  });

  it('returns nothing for text with no domain terms', () => {
    expect(retrieveContext('zxqw blorptang nonsense words here')).toEqual([]);
    expect(retrieveContext('')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(retrieveContext('monograph impurity dissolution', { limit: 2 })).toHaveLength(2);
  });

  it('never exceeds the character budget', () => {
    const hits = retrieveContext('monograph impurity dissolution assay validation', {
      charBudget: 1200,
    });
    const total = hits.reduce((sum, chunk) => sum + chunk.text.length, 0);
    expect(total).toBeLessThanOrEqual(1200);
  });
});

describe('formatPassagesForPrompt', () => {
  it('labels each passage with its document and section', () => {
    const hits = retrieveContext('What is the legal status of the Indian Pharmacopoeia?');
    const formatted = formatPassagesForPrompt(hits);
    expect(formatted).toContain(hits[0].docTitle);
    expect(formatted).toContain(hits[0].section);
  });

  it('warns that an amendment passage is a correction, not the whole requirement', () => {
    const amendment = IPC_KNOWLEDGE_CHUNKS.find((chunk) => chunk.kind === 'AMENDMENT');
    expect(formatPassagesForPrompt([amendment])).toContain('AMENDMENT');
    expect(formatPassagesForPrompt([amendment])).toContain('not the complete requirement');
  });

  it('says so plainly when nothing matched', () => {
    expect(formatPassagesForPrompt([])).toContain('No IPC document passage matched');
  });
});
