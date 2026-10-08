import { describe, it, expect } from 'vitest';
import { matchAutoReply, sentencesOf, similarity } from '../services/autoReply/matcher.js';
import { AUTO_REPLY_ENTRIES, validateDataset } from '../services/autoReply/dataset.js';
import { validateAutoReplyConfig } from '../config/autoReplyConfig.js';

const letter = (question, { greeting = 'Dear Sir/Madam,', signOff = 'Regards,\nRavi Kumar' } = {}) =>
  `${greeting}\n\n${question}\n\n${signOff}`;

describe('reading the question out of a mail', () => {
  it('drops the greeting, the sign-off, the signature and quoted history', () => {
    const body = 'Hello,\n\nWhat is the use case of paracetamol?\nRegards,\nRavi\n\nOn Mon, 5 Oct 2026 Ravi wrote:\n> earlier';
    expect(sentencesOf({ body })).toEqual(['What is the use case of paracetamol?']);
  });

  it('keeps a question written on the greeting line', () => {
    expect(sentencesOf({ body: 'Dear Sir, what is IP Online?' })).toEqual(['what is IP Online?']);
  });

  it('ignores courtesies but keeps every other sentence', () => {
    expect(sentencesOf({ body: 'I hope you are well. I took ten tablets. What is paracetamol used for? Thank you in advance.' })).toEqual([
      'I took ten tablets.',
      'What is paracetamol used for?',
    ]);
  });

  it('falls back to the subject when the body asks nothing', () => {
    expect(sentencesOf({ body: '', subject: 'Re: What is IP Online?' })).toEqual(['What is IP Online?']);
  });
});

describe('similarity', () => {
  it('is 1 only for the very wording, case and punctuation aside', () => {
    expect(similarity('WHAT is the use case of Paracetamol', 'What is the use case of paracetamol?')).toBe(1);
    expect(similarity('the use case of paracetamol is what', 'What is the use case of paracetamol?')).toBeLessThan(1);
    expect(similarity('What is the use case of ibuprofen?', 'What is the use case of paracetamol?')).toBeLessThan(1);
  });
});

describe('matching a mail to a supported question', () => {
  it('offers a reply to the exact question inside a full letter, at 100%', () => {
    const match = matchAutoReply({ subject: 'Query', body: letter('What is the use case of paracetamol?') }, { threshold: 1 });
    expect(match).toMatchObject({ eligible: true, confidence: 1, entryId: 'AR-PARACETAMOL-USE' });
    expect(match.draft).toMatch(/^Dear Sir\/Madam,\n\nParacetamol is a commonly used medicine/);
  });

  it('offers a reply to a listed variant of the question', () => {
    expect(matchAutoReply({ body: letter('What is paracetamol used for?') }, { threshold: 1 })).toMatchObject({
      eligible: true,
      entryId: 'AR-PARACETAMOL-USE',
    });
  });

  it('sends a near miss to a person at 100%, and offers it a reply at a lower threshold', () => {
    const message = { body: letter('What is the main use case of paracetamol?') };
    const strict = matchAutoReply(message, { threshold: 1 });
    expect(strict).toMatchObject({ eligible: false, entryId: 'AR-PARACETAMOL-USE', draft: null });
    expect(strict.reason).toMatch(/below 100%/);
    expect(matchAutoReply(message, { threshold: 0.8 })).toMatchObject({ eligible: true, entryId: 'AR-PARACETAMOL-USE' });
  });

  it('sends a mail that also says something else to a person', () => {
    const match = matchAutoReply({ body: letter('My son took ten tablets. What is the use case of paracetamol?') }, { threshold: 1 });
    expect(match).toMatchObject({ eligible: false, entryId: 'AR-PARACETAMOL-USE' });
    expect(match.confidence).toBeLessThan(0.5);
  });

  it('sends a mail with two different questions to a person', () => {
    const match = matchAutoReply({ body: letter('What is IP Online?\nHow can I purchase IP Reference Substances?') }, { threshold: 1 });
    expect(match).toMatchObject({ eligible: false, entryId: 'AR-IP-ONLINE' });
    expect(match.reason).toMatch(/more than one/);
    // The score is for the whole mail against one question, so the second question pulls it down.
    expect(match.confidence).toBeLessThan(0.5);
  });

  it('sends a mail with attachments to a person', () => {
    const match = matchAutoReply({ body: letter('What is IP Online?'), attachments: [{ filename: 'a.pdf' }] }, { threshold: 1 });
    // The question itself matched fully; the attachments are why a person must look.
    expect(match).toMatchObject({ eligible: false, reason: 'has attachments to read', confidence: 1, entryId: 'AR-IP-ONLINE', draft: null });
  });

  it('never offers a reply to a mail marked as junk', () => {
    expect(matchAutoReply({ body: letter('What is IP Online?') }, { threshold: 1, junk: true })).toMatchObject({
      eligible: false,
      reason: 'marked as possible junk',
      confidence: 1,
    });
  });

  it('sends a mail that asks nothing to a person', () => {
    expect(matchAutoReply({ body: 'Dear Sir,\n\nRegards,\nRavi', subject: '' }, { threshold: 1 }).eligible).toBe(false);
  });
});

describe('the dataset and the threshold', () => {
  it('ships a valid dataset of supported questions', () => {
    expect(validateDataset()).toEqual([]);
    expect(AUTO_REPLY_ENTRIES.length).toBeGreaterThanOrEqual(8);
  });

  it('finds every supported question and variant at 100% (no two entries share a wording)', () => {
    for (const entry of AUTO_REPLY_ENTRIES) {
      for (const wording of [entry.question, ...(entry.variants || [])]) {
        expect(matchAutoReply({ body: letter(wording) }, { threshold: 1 }), wording).toMatchObject({ eligible: true, entryId: entry.id });
      }
    }
  });

  it('refuses a broken dataset', () => {
    expect(validateDataset({ entries: [] })).toHaveLength(1);
    expect(validateDataset({ entries: [{ id: 'A', question: 'Q?', answer: '' }, { id: 'A', question: '', answer: 'x' }] })).toEqual([
      'auto-reply entry A: answer is required',
      'auto-reply entry A: id is used twice',
      'auto-reply entry A: question is required',
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses a threshold of %s', (threshold) => {
    expect(validateAutoReplyConfig({ AUTO_REPLY_ENABLED: true, AUTO_REPLY_CONFIDENCE_THRESHOLD: threshold })).toHaveLength(1);
  });

  it('accepts the default threshold and a lower one', () => {
    expect(validateAutoReplyConfig({ AUTO_REPLY_ENABLED: true, AUTO_REPLY_CONFIDENCE_THRESHOLD: 1 })).toEqual([]);
    expect(validateAutoReplyConfig({ AUTO_REPLY_ENABLED: true, AUTO_REPLY_CONFIDENCE_THRESHOLD: 0.85 })).toEqual([]);
  });
});
