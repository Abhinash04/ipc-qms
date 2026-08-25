import { describe, it, expect } from 'vitest';

import { questionPhrases, qualifyPassages } from '../data/evidenceQualification.js';

const chunk = (section, text, id = 'X#1') => ({
  id,
  docId: 'X',
  docTitle: 'Test Document',
  section,
  text,
});

describe('questionPhrases', () => {
  it('builds adjacent content-word phrases from the question', () => {
    const phrases = questionPhrases('What is the legal status of the Indian Pharmacopoeia?');
    expect(phrases).toContain('legal statu');
  });

  it('adds phrases from multi-word glossary aliases the question matches', () => {
    const question = 'The impurity appears above the identification threshold. Is characterisation required?';
    const phrases = questionPhrases(question);

    expect(phrases).toContain('relat substanc');
    expect(question.toLowerCase()).not.toContain('related substance');
  });

  it('returns nothing for text with no content words', () => {
    expect(questionPhrases('')).toEqual([]);
  });
});

describe('qualifyPassages', () => {
  const question = 'What is the legal status of the Indian Pharmacopoeia?';

  it('qualifies a passage sharing two or more question phrases', () => {
    const candidate = chunk(
      'Some Heading',
      'The legal status of the Indian Pharmacopoeia is established by statute.',
    );
    const { qualified } = qualifyPassages(question, [candidate]);
    expect(qualified).toHaveLength(1);
  });

  it('qualifies a passage sharing one phrase that is in its own heading', () => {
    const candidate = chunk('Legal Status', 'The legal status is described in the Act.');
    const { qualified } = qualifyPassages('Tell me about the legal status', [candidate]);
    expect(qualified).toHaveLength(1);
  });

  it('rejects a passage sharing one phrase only in its body', () => {
    const candidate = chunk(
      'Data Collection and Recording',
      'Records must note the legal status of each retained sample and nothing else here.',
    );
    const { qualified, rejected } = qualifyPassages('Tell me about the legal status', [candidate]);
    expect(qualified).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/one phrase/);
  });

  it('rejects a passage sharing no phrase at all', () => {
    const candidate = chunk('Unrelated', 'This passage is about dissolution apparatus only.');
    const { qualified, rejected } = qualifyPassages(question, [candidate]);
    expect(qualified).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/no phrase/);
  });

  it('qualifies on a rare question term appearing in the heading', () => {
    const candidate = chunk('1. Chemical Analysis › (i) Molarity', 'Molarity is defined as moles per litre of solution.');
    const { qualified } = qualifyPassages('How to calculate molarity of a solution', [candidate]);
    expect(qualified).toHaveLength(1);
  });

  it('does not qualify on a common term appearing in the heading', () => {
    const candidate = chunk('Quality Documentation', 'Documents shall be controlled and reviewed.');
    const { qualified } = qualifyPassages(
      'Which guideline applies to the format of the quality section?',
      [candidate],
    );
    expect(qualified).toHaveLength(0);
  });

  it('handles an empty candidate list', () => {
    expect(qualifyPassages(question, []).qualified).toEqual([]);
    expect(qualifyPassages(question).qualified).toEqual([]);
  });

  it('rejects everything when the question yields no phrase', () => {
    const candidate = chunk('Heading', 'Body text.');
    const { qualified, rejected } = qualifyPassages('', [candidate]);
    expect(qualified).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});
