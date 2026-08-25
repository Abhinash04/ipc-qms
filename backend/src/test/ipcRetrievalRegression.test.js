import { describe, it, expect } from 'vitest';
import { splitEnquiryQuestions } from '../data/enquiryQuestions.js';
import { retrieveContext, expandQuery } from '../data/ipcKnowledge.js';
import { dedupeQuestions, restoreContext, deriveTopic } from '../services/ai/gemmaService.js';
import { qualifyPassages } from '../data/evidenceQualification.js';

const SUBMISSION_BODY = `Dear Sir/Madam,

We require clarification on the documentation to be included in our forthcoming submission.

1. Which guideline currently applies to the format of the quality section, and is the previous format still accepted during the transition period?

2. For a change in the manufacturing site, what supporting documentation is expected, and does the change require prior approval or is notification sufficient?

3. Please confirm the compliance evidence required in respect of the revised labelling requirements.

Regards,
Abhinash Pritiraj
Regulatory Affairs`;

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

describe('the submission-documentation enquiry yields exactly three questions', () => {
  const questions = splitEnquiryQuestions(SUBMISSION_BODY);

  it('finds exactly three, excluding the preamble', () => {
    expect(questions).toHaveLength(3);
  });

  it('drops the "We require clarification on the documentation" preamble', () => {
    expect(questions.join(' ')).not.toContain('forthcoming submission');
  });

  it('covers quality-section guideline and the transition period', () => {
    expect(questions[0]).toContain('quality section');
    expect(questions[0]).toContain('transition period');
  });

  it('covers manufacturing-site change documentation and approval versus notification', () => {
    expect(questions[1]).toContain('manufacturing site');
    expect(questions[1]).toContain('notification');
  });

  it('covers the revised labelling compliance evidence', () => {
    expect(questions[2]).toContain('labelling');
    expect(questions[2]).toContain('compliance evidence');
  });

  it('contains no duplicate question', () => {
    const normalised = questions.map((q) => q.toLowerCase().replace(/\s+/g, ' ').trim());
    expect(new Set(normalised).size).toBe(questions.length);
  });
});

describe('deduplication of decomposed questions', () => {
  it('collapses repeats while preserving original order', () => {
    const deduped = dedupeQuestions(['Alpha one?', 'Beta two?', 'alpha  ONE?', 'Gamma three?']);
    expect(deduped).toEqual(['Alpha one?', 'Beta two?', 'Gamma three?']);
  });

  it('ignores blank entries', () => {
    expect(dedupeQuestions(['', '   ', 'Real question?'])).toEqual(['Real question?']);
  });

  it('collapses two sub-questions of one parent into a single question', () => {
    const deterministic = [
      'Which guideline currently applies to the format of the quality section, and is the previous format still accepted during the transition period?',
    ];
    const modelSplit = [
      'Which guideline currently applies to the format of the quality section',
      'is the previous format still accepted during the transition period',
    ];

    expect(restoreContext(modelSplit, deterministic)).toEqual(deterministic);
  });

  it('keeps a model question that has no deterministic parent', () => {
    const restored = restoreContext(['An unrelated question?'], ['Some other parent question?']);
    expect(restored).toEqual(['An unrelated question?']);
  });
});

describe('deriveTopic produces a concise heading', () => {
  it('strips interrogative openers and stop words', () => {
    expect(deriveTopic('Which guideline currently applies to the format of the quality section?')).toBe(
      'Guideline applies format quality',
    );
  });

  it('never returns a full sentence', () => {
    const topic = deriveTopic(
      'Please confirm the compliance evidence required in respect of the revised labelling requirements.',
    );
    expect(topic.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(topic).not.toContain('?');
  });

  it('falls back rather than returning an empty heading', () => {
    expect(deriveTopic('')).toBe('Enquiry');
    expect(deriveTopic('the and of')).toBe('The and of');
  });
});

describe('tangential passages are not qualified as evidence', () => {
  const qualifiedFor = (question) => {
    const candidates = retrieveContext(question, { limit: 12, charBudget: 20000 });
    return qualifyPassages(question, candidates).qualified;
  };

  const submission = splitEnquiryQuestions(SUBMISSION_BODY);
  const label = (chunks) => chunks.map((c) => `${c.docId} ${c.section}`);

  it('qualifies nothing for the quality-section question', () => {
    expect(label(qualifiedFor(submission[0]))).toEqual([]);
  });

  it('excludes the GMP Data Collection passage that previously padded question 1', () => {
    const candidates = retrieveContext(submission[0], { limit: 12, charBudget: 20000 });
    expect(label(candidates).some((s) => /Data Collection and Recording/.test(s))).toBe(true);
    expect(label(qualifiedFor(submission[0])).some((s) => /Data Collection/.test(s))).toBe(false);
  });

  it('qualifies nothing for the manufacturing-site question', () => {
    expect(label(qualifiedFor(submission[1]))).toEqual([]);
  });

  it('qualifies nothing for the revised-labelling question', () => {
    expect(label(qualifiedFor(submission[2]))).toEqual([]);
  });

  it('excludes the GMP Data Reviewing passage that previously padded question 3', () => {
    expect(label(qualifiedFor(submission[2])).some((s) => /Data Reviewing/.test(s))).toBe(false);
  });

  it('lets no LIMS, specimen-signature or CoA-retention prose through for those questions', () => {
    const text = submission
      .flatMap((q) => qualifiedFor(q))
      .map((c) => c.text)
      .join(' ');
    expect(text).not.toMatch(/LIMS/i);
    expect(text).not.toMatch(/specimen signature/i);
  });

  it('still qualifies the Related Substances guidance for the degradation question', () => {
    const [deg1] = splitEnquiryQuestions(BODY);
    expect(label(qualifiedFor(deg1)).some((s) => /GD-10 .*Related Substances/.test(s))).toBe(true);
  });

  it.each([
    ['What is the legal status of the Indian Pharmacopoeia? Is it legally enforceable?', /legal status/i],
    ['Can we apply an alternative analytical procedure instead of the official IP method?', /alternative analytical/i],
    ['Where can I purchase IPRS and impurity standards?', /purchase IPRS/i],
    ['Does the IPC approve drugs or grant marketing authorisation?', /drug approval/i],
  ])('still qualifies the known-correct passage for: %s', (question, expected) => {
    expect(label(qualifiedFor(question)).some((s) => expected.test(s))).toBe(true);
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
