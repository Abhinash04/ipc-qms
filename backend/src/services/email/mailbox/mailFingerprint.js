import { createHash } from 'crypto';
import { bare, htmlText } from './triageRules.js';

const REPLY_PREFIX = /^\s*((re|fwd?|fw|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i;
const REG_SUFFIX = /\s*[-–—]\s*reg\.?\s*$/i;

const QUOTE_START = [
  /^\s*on .{1,200} wrote:\s*$/im,
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/im,
  /^\s*from:\s.+\n\s*(sent|date):\s/im,
];

const QUERY_ID = /\bQRY-\d{4}-\d{5}\b/gi;

export const senderKey = (from) => bare(from) || null;

export function normaliseSubject(subject) {
  return String(subject || '')
    .replace(REPLY_PREFIX, '')
    .replace(REG_SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function bodyText({ body = '', bodyHtml = '' } = {}) {
  let text = String(body || '').trim() ? String(body) : htmlText(bodyHtml);
  for (const marker of QUOTE_START) {
    const at = text.search(marker);
    if (at > 0) text = text.slice(0, at);
  }
  return text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function contentHash(message = {}) {
  const names = (Array.isArray(message.attachments) ? message.attachments : [])
    .map((attachment) => String(attachment?.filename || '').toLowerCase())
    .filter(Boolean)
    .sort();
  const canonical = [normaliseSubject(message.subject), tokens(bodyText(message)).join(' '), names.join('|')].join('\n');
  return createHash('sha1').update(canonical).digest('hex');
}

export function shingles(text, size = 3) {
  const words = tokens(text);
  if (words.length < size) return new Set(words);
  const out = new Set();
  for (let index = 0; index + size <= words.length; index += 1) out.add(words.slice(index, index + size).join(' '));
  return out;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function queryIdsIn(...texts) {
  const found = new Set();
  for (const text of texts) {
    for (const match of String(text || '').matchAll(QUERY_ID)) found.add(match[0].toUpperCase());
  }
  return [...found];
}
