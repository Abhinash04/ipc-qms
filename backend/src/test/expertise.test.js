import { describe, it, expect } from 'vitest';
import { EXPERTISE_AREAS, expandExpertise } from '../constants/expertise.js';
import { ASSIGNED_OFFICIALS } from '../config/officialsMetadata.js';

describe('expandExpertise', () => {
  it('expands an area, whatever its case, into its own name and its subject phrases', () => {
    const terms = expandExpertise(['Microbiology']);
    expect(terms).toContain('microbiology');
    expect(terms).toEqual(expect.arrayContaining(['sterility', 'endotoxin', 'bioburden']));
  });

  it('keeps any other phrase as it is, lowercased', () => {
    expect(expandExpertise(['Nitrosamine Impurities', 'hplc'])).toEqual(['nitrosamine impurities', 'hplc']);
  });

  it('lists each phrase once when areas overlap, and skips blanks', () => {
    const terms = expandExpertise(['quality control', 'pharmaceutical standards', '  ', null]);
    expect(terms.filter((term) => term === 'specification')).toHaveLength(1);
    expect(terms).not.toContain('');
  });

  it('is empty for an official with no expertise', () => {
    expect(expandExpertise([])).toEqual([]);
    expect(expandExpertise()).toEqual([]);
  });

  it('leaves the built-in officials’ keyword lists unchanged', () => {
    for (const official of ASSIGNED_OFFICIALS) expect(expandExpertise(official.expertise)).toEqual(official.expertise);
  });

  it('uses only lowercase subject phrases longer than three letters, as matching is by substring', () => {
    for (const { keywords } of EXPERTISE_AREAS) {
      for (const keyword of keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
        expect(keyword.length).toBeGreaterThan(3);
      }
    }
  });
});
