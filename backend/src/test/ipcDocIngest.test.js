import { describe, it, expect } from 'vitest';

import {
  repairLatexEscapes,
  stripBoilerplate,
  chunkByHeadings,
  expertWorkingGroupNames,
} from '../data/ipcDocIngest.js';

describe('repairLatexEscapes', () => {
  it('restores \\times, \\text and \\frac destroyed by escape interpretation', () => {
    const damaged = '$$M = rac{1000 \times W}{V \times \text{Mol. wt.}}$$';
    expect(repairLatexEscapes(damaged)).toBe(
      '$$M = \\frac{1000 \\times W}{V \\times \\text{Mol. wt.}}$$',
    );
  });

  it('leaves no raw tab behind', () => {
    expect(repairLatexEscapes('$a \times b$')).not.toMatch(/\t/);
  });

  it('restores \\rightarrow and \\rightleftharpoons from carriage returns', () => {
    expect(repairLatexEscapes('$A \rightarrow B$')).toContain('\\rightarrow');
    expect(repairLatexEscapes('$A \rightleftharpoons B$')).toContain('\\rightleftharpoons');
  });

  it('restores bare macro names inside math spans only', () => {
    const repaired = repairLatexEscapes('rotation $alpha$ here, and prose alpha stays');
    expect(repaired).toContain('$\\alpha$');
    expect(repaired).toContain('prose alpha stays');
  });

  it('leaves already-correct LaTeX untouched', () => {
    const clean = '$\\text{La}_2\\text{O}_3 = 325.8$';
    expect(repairLatexEscapes(clean)).toBe(clean);
  });

  it('does not corrupt ordinary prose containing the letters rac', () => {
    const prose = 'The tracer and the characteristic bracket.';
    expect(repairLatexEscapes(prose)).toBe(prose);
  });
});

describe('stripBoilerplate', () => {
  const doc = [
    '# Guidance Document: Something',
    '',
    '### Disclaimer',
    '',
    'This Guidance Document is compiled by the Indian Pharmacopoeia Commission (IPC) after consultations.',
    '',
    '## Introduction',
    '',
    'Real content that must survive.',
    '',
    '## References',
    '',
    '1. Some citation.',
  ].join('\n');

  it('removes the disclaimer section', () => {
    const stripped = stripBoilerplate(doc);
    expect(stripped).not.toContain('Disclaimer');
    expect(stripped).not.toContain('compiled by the Indian Pharmacopoeia Commission');
  });

  it('removes the references section', () => {
    expect(stripBoilerplate(doc)).not.toContain('Some citation');
  });

  it('keeps the substantive content', () => {
    const stripped = stripBoilerplate(doc);
    expect(stripped).toContain('## Introduction');
    expect(stripped).toContain('Real content that must survive.');
  });
});

describe('chunkByHeadings', () => {
  const faq = [
    '# Frequently Asked Questions',
    '',
    '### 1. What is the legal status of the IP?',
    'It is the official book of standards for drugs in India and is legally enforceable.',
    '',
    '### 2. Does the IPC approve drugs?',
    'No. CDSCO and the State Licensing Authorities take regulatory decisions.',
  ].join('\n');

  it('emits one chunk per deepest heading', () => {
    const chunks = chunkByHeadings(faq, { docId: 'FAQ', title: 'FAQ', kind: 'FAQ' });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].section).toBe('1. What is the legal status of the IP?');
    expect(chunks[1].text).toContain('CDSCO');
  });

  it('gives every chunk a unique id derived from the docId', () => {
    const chunks = chunkByHeadings(faq, { docId: 'FAQ', title: 'FAQ', kind: 'FAQ' });
    expect(chunks.map((c) => c.id)).toEqual(['FAQ#1', 'FAQ#2']);
  });

  it('carries the ancestor breadcrumb into the section label', () => {
    const nested = [
      '# Guidance',
      '## Validation Process',
      '### Specificity',
      'Specificity is the ability to assess the analyte unequivocally in the presence of others.',
    ].join('\n');

    const [chunk] = chunkByHeadings(nested, { docId: 'GD-04', title: 'GD-04', kind: 'GUIDANCE' });
    expect(chunk.section).toBe('Validation Process › Specificity');
  });

  it('stamps amendment chunks with their amendment list number', () => {
    const amendment = [
      '# INDIAN PHARMACOPOEIA COMMISSION',
      '## AMENDMENT LIST-04 TO IP 2022',
      '### Budesonide. Page 1674',
      'Insert before Loss on drying: the content of epimer A is 40.0 to 51.0 per cent.',
    ].join('\n');

    const [chunk] = chunkByHeadings(amendment, {
      docId: 'AL-04-2022',
      title: 'Amendment List 04',
      kind: 'AMENDMENT',
    });
    expect(chunk.amendmentList).toBe('Amendment List-04');
    expect(chunk.section).toContain('Amendment List-04');
    expect(chunk.section).toContain('Budesonide. Page 1674');
  });

  it('suppresses roster sections', () => {
    const roster = [
      '# INDIAN PHARMACOPOEIA COMMISSION',
      '### Commission Members',
      'Shri Zoher Sihorwala, Wockhardt Research Centre, D4, MIDC, Aurangabad-431 006.',
      '### Analytical Research and Development Division',
      'Dr. A. Person, Dr. B. Person, Dr. C. Person, Dr. D. Person, Dr. E. Person.',
    ].join('\n');

    const chunks = chunkByHeadings(roster, { docId: 'EWG', title: 'EWG', kind: 'REFERENCE' });
    expect(chunks).toHaveLength(0);
  });

  it('repairs LaTeX before chunking so no chunk carries a raw tab', () => {
    const damaged = [
      '# Calculations',
      '## Molarity',
      'Molarity is $$M = rac{1000 \times W}{V \times \text{Mol. wt.}}$$ for a given solute mass.',
    ].join('\n');

    const [chunk] = chunkByHeadings(damaged, { docId: 'GD-10', title: 'GD-10', kind: 'GUIDANCE' });
    expect(chunk.text).not.toMatch(/\t/);
    expect(chunk.text).toContain('\\frac');
  });
});

describe('expertWorkingGroupNames', () => {
  it('returns the group names without their member rosters', () => {
    const ewg = [
      '# INDIAN PHARMACOPOEIA COMMISSION',
      '## IP ADDENDUM 2024',
      '### Commission Members',
      'Some Person, Another Person.',
      '## Expert Working Groups',
      '### Excipients',
      'Dr. A. Person, Dr. B. Person.',
      '### Medical Devices',
      'Dr. C. Person.',
      '## IPC Secretariat and Staff',
      '### Biologics Division',
      'Dr. D. Person.',
    ].join('\n');

    expect(expertWorkingGroupNames(ewg)).toEqual(['Excipients', 'Medical Devices']);
  });
});
