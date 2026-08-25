import { describe, it, expect } from 'vitest';
import { splitEnquiryQuestions } from '../data/enquiryQuestions.js';
import { retrieveContext, expandQuery } from '../data/ipcKnowledge.js';

const SUBJECT = 'Query on degradation products and excipient compatibility in a stability study';

const BODY = `Dear Sir/Madam,

During accelerated stability studies of our tablet formulation we have observed a degradation product that is not listed in the monograph.

1. The impurity appears above the identification threshold at 40 degrees Celcius and 75 percent RH but remains below it at long-term conditions. Is characterisation required in this case, and should it be reported in the specification?

2. We suspect an interaction between the active substance and one of the excipients used in the formulation. Is there published guidance on excipient compatibility study design that we should follow?

We would be grateful for direction on whether a change of excipient would require a fresh stability commitment.

Regards,
Abhinash Pritiraj
Formulation Development`;

const sectionsOf = (chunks) => chunks.map((c) => `${c.docId} ${c.section}`);

describe('the degradation-product enquiry is split into its three questions', () => {
  const questions = splitEnquiryQuestions(BODY);

  it('finds exactly three questions', () => {
    expect(questions).toHaveLength(3);
  });

  it('keeps the two numbered questions separate', () => {
    expect(questions[0]).toContain('identification threshold');
    expect(questions[0]).toContain('reported in the specification');
    expect(questions[1]).toContain('excipient compatibility study design');
  });

  it('catches the unnumbered third question phrased as a request', () => {
    expect(questions[2]).toContain('fresh stability commitment');
  });

  it('drops the greeting, the sign-off and the sender block', () => {
    const joined = questions.join(' ');
    expect(joined).not.toContain('Dear Sir/Madam');
    expect(joined).not.toContain('Abhinash Pritiraj');
    expect(joined).not.toContain('Formulation Development');
  });
});

describe('question 1 retrieves the degradation and related-substances material', () => {
  const [q1] = splitEnquiryQuestions(BODY);
  const hits = retrieveContext(q1, { limit: 5 });

  it('surfaces the Related Substances guidance the blended query missed', () => {
    expect(sectionsOf(hits).some((s) => /GD-10 .*Related Substances/.test(s))).toBe(true);
  });

  it('does not surface the Schedule V additives passage', () => {
    expect(sectionsOf(hits).some((s) => /SCHEDULE V/.test(s))).toBe(false);
  });

  it('expands the query with related-substance vocabulary from the glossary', () => {
    const expanded = expandQuery(q1).toLowerCase();
    expect(expanded).toContain('related substance');
  });
});

describe('per-question retrieval beats one blended query', () => {
  const whole = retrieveContext(`${SUBJECT} ${BODY}`, { limit: 5 });
  const perQuestion = splitEnquiryQuestions(BODY).flatMap((q) =>
    retrieveContext(q, { limit: 5 }),
  );

  const hasRelatedSubstances = (chunks) =>
    sectionsOf(chunks).some((s) => /GD-10 .*Related Substances/.test(s));

  it('the blended query misses the Related Substances guidance', () => {
    expect(hasRelatedSubstances(whole)).toBe(false);
  });

  it('splitting the enquiry finds it', () => {
    expect(hasRelatedSubstances(perQuestion)).toBe(true);
  });
});

describe('the corpus gap on questions 2 and 3 is pinned, not papered over', () => {
  const questions = splitEnquiryQuestions(BODY);

  it('has no material on excipient compatibility study design', () => {
    const hits = retrieveContext(questions[1], { limit: 5 });
    expect(sectionsOf(hits).some((s) => /compatibilit/i.test(s))).toBe(false);
  });

  it('has no material on stability commitments', () => {
    const hits = retrieveContext(questions[2], { limit: 5 });
    expect(sectionsOf(hits).some((s) => /stability commitment/i.test(s))).toBe(false);
  });
});

describe('splitEnquiryQuestions handles the ordinary shapes too', () => {
  it('returns a single question for a one-question enquiry', () => {
    const single = splitEnquiryQuestions(
      'Dear Sir,\n\nPlease clarify the applicable monograph for our product.\n\nRegards,\nX',
    );
    expect(single).toEqual(['Please clarify the applicable monograph for our product.']);
  });

  it('falls back to the whole body when nothing looks like a question', () => {
    const none = splitEnquiryQuestions(
      'Dear Sir,\n\nWe write to inform you of our new address.\n\nRegards,\nX',
    );
    expect(none).toHaveLength(1);
    expect(none[0]).toContain('new address');
  });

  it('returns nothing for an empty body', () => {
    expect(splitEnquiryQuestions('')).toEqual([]);
    expect(splitEnquiryQuestions(null)).toEqual([]);
  });
});
