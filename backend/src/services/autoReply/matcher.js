import { AUTO_REPLY_DATASET_VERSION, AUTO_REPLY_ENTRIES } from './dataset.js';

/**
 * Decides whether a mail can be offered an automatic reply: it must ask only questions from the
 * supported list, all the same one, at or above the confidence threshold. Any other sentence (a
 * remark about a patient, a second request, a signature without a sign-off) sends it to a person.
 */

export const MATCHER = `mock-dataset-v${AUTO_REPLY_DATASET_VERSION}`;

// "Dear Sir/Madam," "Hello," "Good morning team," at the start of a line.
const LEADING_GREETING = /^(dear|hi|hello|respected|greetings|good (morning|afternoon|evening))\b[^,!.?]*[,!.]?\s*/i;
const SIGN_OFF = /^(regards|thanks|thank you|sincerely|yours|best|warm regards|kind regards|with regards)\b/i;
// Where a quoted earlier message begins.
const QUOTED = /^(>|on .+ wrote:$|-+ ?original message ?-+$|from: )/i;
// Sentences that ask nothing of their own.
const COURTESY = [
  /^(thank you|thanks)( (very|so) much)?( in advance)?[.!]?$/i,
  /^(kindly|please) (help|reply|respond|advise)( me)?[.!]?$/i,
  /^i hope (you are|this (e-?mail|mail|message) finds you) well[.!]?$/i,
  /^sent from my /i,
];

export const normalise = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokens = (text) => new Set(text.split(' ').filter(Boolean));

/** 1 for the very wording of a question (case and punctuation aside), else at most 0.99. */
export function similarity(a, b) {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const left = tokens(x);
  const right = tokens(y);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return Math.min(shared / (left.size + right.size - shared), 0.99);
}

/** The sentences a mail asks, without its greeting, sign-off, quoted history or courtesies. */
export function sentencesOf({ body = '', subject = '' } = {}) {
  const lines = [];
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SIGN_OFF.test(line) || QUOTED.test(line)) break;
    const text = line.replace(LEADING_GREETING, '').trim();
    if (text) lines.push(text);
  }

  const sentences = lines
    .join(' ')
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => normalise(sentence) && !COURTESY.some((pattern) => pattern.test(sentence)));
  if (sentences.length) return sentences;

  const topic = String(subject || '').replace(/^((re|fwd?):\s*)+/i, '').trim();
  return normalise(topic) ? [topic] : [];
}

// How well a sentence matches an entry: its best score against the question or any variant.
const scoreFor = (sentence, entry) =>
  Math.max(...[entry.question, ...(entry.variants || [])].map((wording) => similarity(sentence, wording)));

function closest(sentence, entries) {
  let best = { entry: null, score: 0 };
  for (const entry of entries) {
    const score = scoreFor(sentence, entry);
    if (score > best.score) best = { entry, score };
  }
  return best;
}

/** The reply offered for an entry; the official closing is added when it is sent. */
export const draftFor = (entry) => `Dear Sir/Madam,\n\n${entry.answer}`;

const percent = (value) => `${Math.round(value * 100)}%`;

/**
 * { eligible, confidence, entryId, topic, question, draft, reason } for one mail. The confidence
 * is how well the whole mail matches its closest supported question: every sentence is scored
 * against that one question, so a second question or any other remark pulls it down. It is
 * worked out for every mail, including those sent to a person for another reason (attachments,
 * a junk verdict), so the Front Office always sees it with the reason.
 */
export function matchAutoReply(message = {}, { threshold = 1, entries = AUTO_REPLY_ENTRIES, junk = false } = {}) {
  const result = (eligible, reason, { confidence = 0, entry = null } = {}) => ({
    eligible,
    confidence,
    entryId: entry?.id ?? null,
    topic: entry?.topic ?? null,
    question: entry?.question ?? null,
    draft: eligible ? draftFor(entry) : null,
    reason,
  });

  const sentences = sentencesOf(message);
  if (!sentences.length) return result(false, 'asks no question');

  const matches = sentences.map((sentence) => closest(sentence, entries));
  const entry = matches.reduce((best, match) => (match.score > best.score ? match : best)).entry;
  if (!entry) return result(false, 'matches no supported question');

  const scored = { confidence: Math.min(...sentences.map((sentence) => scoreFor(sentence, entry))), entry };
  if (junk) return result(false, 'marked as possible junk', scored);
  if (message.attachments?.length) return result(false, 'has attachments to read', scored);
  if (matches.some((match) => match.entry && match.entry.id !== entry.id)) {
    return result(false, 'asks more than one supported question, or something else as well', scored);
  }
  if (scored.confidence < threshold) {
    return result(
      false,
      `closest supported question "${entry.question}" matched ${percent(scored.confidence)}, below ${percent(threshold)}`,
      scored,
    );
  }
  return result(true, `matches the supported question "${entry.question}"`, scored);
}
