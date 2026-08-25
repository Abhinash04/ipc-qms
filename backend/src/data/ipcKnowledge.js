import { createRequire } from 'node:module';

import { IPC_DOCS } from './ipcDocs.manifest.js';
import { selectContext } from './ipcContextBrain.js';

const require = createRequire(import.meta.url);
const knowledge = require('./ipcKnowledge.json');

export const IPC_KNOWLEDGE_CHUNKS = knowledge.chunks;
export const IPC_KNOWLEDGE_MANIFEST = {
  totals: knowledge.totals,
  ingested: knowledge.ingested,
  skipped: knowledge.skipped,
};

const PRIORITY_BY_DOC = Object.fromEntries(IPC_DOCS.map((doc) => [doc.docId, doc.priority || 1]));

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'would', 'like', 'please', 'dear', 'sir',
  'madam', 'regards', 'thank', 'you', 'your', 'our', 'are', 'was', 'have', 'has', 'been', 'their',
  'about', 'also', 'any', 'may', 'can', 'will', 'shall', 'should', 'while', 'which', 'whether',
  'regarding', 'seek', 'writing', 'kindly', 'request', 'query', 'enquiry', 'inquiry', 'information',
  'details', 'provide', 'need', 'want', 'know', 'help', 'there', 'they', 'what', 'when', 'where',
  'how', 'why', 'not', 'all', 'per', 'use', 'used', 'using', 'into', 'out', 'its', 'his', 'her',
  'here', 'words', 'word', 'thing', 'things', 'some', 'such', 'each', 'both', 'other', 'others',
  'same', 'than', 'then', 'them', 'these', 'those', 'been', 'being', 'were', 'does', 'did', 'done',
  'having', 'must', 'could', 'might', 'above', 'below', 'under', 'over', 'more', 'most', 'less',
  'least', 'very', 'much', 'many', 'only', 'also', 'even', 'ever', 'never', 'always', 'often',
  'case', 'cases', 'given', 'give', 'take', 'make', 'made', 'get', 'got', 'see', 'seen', 'say',
  'said', 'one', 'two', 'three', 'first', 'second', 'third', 'new', 'old', 'same', 'via', 'etc',
]);

const SUFFIXES = [
  'ations', 'ation', 'ities', 'ility', 'ments', 'ment', 'ings', 'ing', 'ions', 'ion',
  'ives', 'ive', 'ies', 'ied', 'ers', 'als', 'al', 'es', 'ed', 'ly', 's',
];

const MIN_STEM = 4;

function stem(token) {
  if (/\d/.test(token)) return token;

  let out = token;
  for (const suffix of SUFFIXES) {
    if (out.length - suffix.length >= MIN_STEM && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  if (out.length > MIN_STEM && out.endsWith('e')) out = out.slice(0, -1);
  return out;
}

export const contentTokens = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .map(stem);

let indexCache = null;

function buildIndex() {
  if (indexCache) return indexCache;

  const documentFrequency = new Map();
  const entries = IPC_KNOWLEDGE_CHUNKS.map((chunk) => {
    const haystack = `${chunk.section} ${chunk.text}`.toLowerCase();
    const titleHaystack = `${chunk.docTitle} ${chunk.section}`.toLowerCase();
    const terms = new Set(contentTokens(haystack));

    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }

    return { chunk, haystack, titleHaystack, terms };
  });

  indexCache = { entries, documentFrequency, total: entries.length };
  return indexCache;
}

const COMMON_TERM_RATIO = 0.25;
const MIN_SCORE = 2.5;
const RARE_TERM_RATIO = 0.015;

export function isRareTerm(term) {
  const { documentFrequency, total } = buildIndex();
  const frequency = documentFrequency.get(term) || 0;
  return frequency > 0 && frequency <= total * RARE_TERM_RATIO;
}

export function expandQuery(text) {
  const aliases = selectContext(text, { limit: 6 }).flatMap((entry) => [
    entry.term,
    ...(entry.aliases || []),
  ]);
  return aliases.length ? `${text} ${aliases.join(' ')}` : String(text || '');
}

export function retrieveContext(text, { limit = 4, charBudget = 3000, expand = true } = {}) {
  const query = expand ? expandQuery(text) : String(text || '');
  const queryTerms = [...new Set(contentTokens(query))];
  if (queryTerms.length === 0) return [];

  const { entries, documentFrequency, total } = buildIndex();
  const discriminating = queryTerms.filter(
    (term) => (documentFrequency.get(term) || 0) <= total * COMMON_TERM_RATIO,
  );
  if (discriminating.length === 0) return [];

  const scored = [];

  for (const entry of entries) {
    let score = 0;
    let matched = 0;

    for (const term of discriminating) {
      if (!entry.terms.has(term)) continue;
      matched += 1;
      const frequency = documentFrequency.get(term) || 1;
      const weight = Math.log(1 + total / frequency);
      score += weight;
      if (entry.titleHaystack.includes(term)) score += weight * 0.75;
    }

    score *= Math.sqrt(matched / discriminating.length);
    if (score < MIN_SCORE) continue;
    score *= 1 + (PRIORITY_BY_DOC[entry.chunk.docId] || 1) / 10;
    scored.push({ chunk: entry.chunk, score });
  }

  scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));

  const selected = [];
  let used = 0;

  for (const { chunk } of scored) {
    if (selected.length >= limit || used >= charBudget) break;

    const remaining = charBudget - used;
    if (chunk.text.length > remaining) {
      if (selected.length > 0) continue;
      selected.push({ ...chunk, text: `${chunk.text.slice(0, remaining - 1).trimEnd()}…` });
      break;
    }

    selected.push(chunk);
    used += chunk.text.length;
  }

  return selected;
}

export function formatPassagesForPrompt(chunks = []) {
  if (chunks.length === 0) return 'No IPC document passage matched this enquiry.';

  return chunks
    .map((chunk) => {
      const ref = chunk.documentId ? `${chunk.docTitle}, ${chunk.documentId}` : chunk.docTitle;
      const caution =
        chunk.kind === 'AMENDMENT'
          ? ' [AMENDMENT — a correction to a monograph, not the complete requirement; always state the amendment list and page]'
          : '';
      return `- [${ref} › ${chunk.section}]${caution}\n${chunk.text}`;
    })
    .join('\n\n');
}
