import { contentTokens, isRareTerm } from './ipcKnowledge.js';
import { selectContext } from './ipcContextBrain.js';

const MIN_SHARED_PHRASES = 2;

const bigrams = (tokens) =>
  tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`);

export function questionPhrases(question) {
  const own = bigrams(contentTokens(question));

  const glossary = selectContext(question, { limit: 6 })
    .flatMap((entry) => [entry.term, ...(entry.aliases || [])])
    .filter((alias) => String(alias).trim().includes(' '))
    .flatMap((alias) => bigrams(contentTokens(alias)));

  return [...new Set([...own, ...glossary])];
}

export function qualifyPassages(question, candidates = []) {
  const phrases = questionPhrases(question);
  const questionTerms = [...new Set(contentTokens(question))];
  const qualified = [];
  const rejected = [];

  if (phrases.length === 0) {
    return { qualified, rejected: candidates.map((chunk) => ({ chunk, shared: [], reason: 'the question yields no phrase to match on' })) };
  }

  for (const chunk of candidates) {
    const bodyPhrases = new Set(bigrams(contentTokens(`${chunk.section} ${chunk.text}`)));
    const headingPhrases = new Set(bigrams(contentTokens(chunk.section)));

    const shared = phrases.filter((phrase) => bodyPhrases.has(phrase));
    const inHeading = shared.some((phrase) => headingPhrases.has(phrase));

    const headingTokens = new Set(contentTokens(chunk.section));
    const rareInHeading = questionTerms.some(
      (term) => headingTokens.has(term) && isRareTerm(term),
    );

    if (
      shared.length >= MIN_SHARED_PHRASES ||
      (shared.length === 1 && inHeading) ||
      rareInHeading
    ) {
      qualified.push(chunk);
      continue;
    }

    rejected.push({
      chunk,
      shared,
      reason:
        shared.length === 0
          ? 'shares no phrase with the question'
          : 'shares one phrase, and not in its own heading',
    });
  }

  return { qualified, rejected };
}
