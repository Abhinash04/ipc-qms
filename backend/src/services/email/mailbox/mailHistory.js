import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { MailboxTriage } from '../../../models/MailboxTriage.js';
import { QueryCase } from '../../../models/QueryCase.js';
import { EmailMessage } from '../../../models/EmailMessage.js';
import {
  CATEGORY_SOURCES,
  MAIL_CATEGORIES,
  MAIL_CATEGORY_INFO,
  RELATION_KINDS,
} from '../../../constants/mailCategories.js';
import { bodyText, contentHash, jaccard, normaliseSubject, queryIdsIn, senderKey, shingles } from './mailFingerprint.js';

const HISTORY_DAYS = 30;
const SENDER_ROWS = 20;
const RECENT_CASES = 200;
const THREAD_ROWS = 10;
const MAX_RELATED = 3;

const SAME_SENDER_SIMILARITY = 0.85;
const CASE_SIMILARITY = 0.6;

const PROFILE_MIN = 3;
const PROFILE_SHARE = 0.66;
const PROFILE_CATEGORIES = new Set([
  MAIL_CATEGORIES.OFFICIAL_QUERY,
  MAIL_CATEGORIES.EVENT_INVITATION,
  MAIL_CATEGORIES.SYSTEM_NOTIFICATION,
  MAIL_CATEGORIES.ADVERTISEMENT,
]);

const DAY_MS = 24 * 60 * 60 * 1000;

const label = (category) => MAIL_CATEGORY_INFO[category]?.label ?? category;

const quoted = (text) => `"${String(text || '(no subject)').replace(/\s+/g, ' ').slice(0, 120)}"`;

const fingerprintText = (message) => `${normaliseSubject(message.subject)} ${bodyText(message)}`;

export function createHistoryContext() {
  return { cases: null };
}

function recentCases(ctx) {
  ctx.cases ??= QueryCase.find({})
    .select('queryId subject description inquirer businessStatus sourceMailboxMessageId createdAt')
    .sort({ createdAt: -1 })
    .limit(RECENT_CASES)
    .lean()
    .then((rows) => rows.map((row) => ({ ...row, shingles: shingles(`${normaliseSubject(row.subject)} ${row.description || ''}`) })));
  return ctx.cases;
}

const isEarlier = (candidate, receivedAt, id) =>
  candidate.receivedAt < receivedAt || (candidate.receivedAt === receivedAt && candidate.mailboxMessageId < id);

function senderProfile(rows) {
  const counted = rows.filter((row) => row.category && row.category !== MAIL_CATEGORIES.DUPLICATE);
  const counts = {};
  for (const row of counted) counts[row.category] = (counts[row.category] || 0) + 1;
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant =
    top && PROFILE_CATEGORIES.has(top[0]) && top[1] >= PROFILE_MIN && top[1] / counted.length >= PROFILE_SHARE
      ? top[0]
      : null;
  return { total: rows.length, counts, dominant };
}

async function threadCases(message) {
  if (!message.providerThreadId) return [];
  const rows = await EmailMessage.find({ providerThreadId: message.providerThreadId, queryId: { $ne: null } })
    .select('queryId')
    .limit(THREAD_ROWS)
    .lean();
  return [...new Set(rows.map((row) => row.queryId).filter(Boolean))];
}

export async function findRelated(message, row = {}, ctx = createHistoryContext()) {
  const id = message.mailboxMessageId;
  const key = row.senderKey || senderKey(message.from);
  const hash = row.contentHash || contentHash(message);
  const receivedAt = row.receivedAt || message.receivedAt || new Date().toISOString();
  const since = new Date(Date.parse(receivedAt) - HISTORY_DAYS * DAY_MS).toISOString();

  const related = [];
  const lines = [];
  let pinned = null;
  const link = (entry) => {
    if (related.length >= MAX_RELATED) return;
    if (related.some((known) => known.kind === entry.kind && known.mailboxMessageId === entry.mailboxMessageId && known.queryId === entry.queryId)) return;
    related.push({ mailboxMessageId: null, queryId: null, score: null, ...entry });
  };

  const earlier = key
    ? (
        await MailboxTriage.find({ senderKey: key, receivedAt: { $gte: since, $lte: receivedAt } })
          .select('mailboxMessageId contentHash category categorySource receivedAt subject')
          .sort({ receivedAt: -1 })
          .limit(SENDER_ROWS + 1)
          .lean()
      ).filter((candidate) => candidate.mailboxMessageId !== id && isEarlier(candidate, receivedAt, id))
    : [];

  const cases = await recentCases(ctx);
  const caseFor = (mailboxMessageId) => cases.find((found) => found.sourceMailboxMessageId === mailboxMessageId) ?? null;

  const original = earlier.find((candidate) => candidate.contentHash && candidate.contentHash === hash);
  if (original) {
    const queryId = caseFor(original.mailboxMessageId)?.queryId ?? null;
    link({ kind: RELATION_KINDS.EXACT_DUPLICATE, mailboxMessageId: original.mailboxMessageId, queryId, score: 1 });
    pinned = {
      category: MAIL_CATEGORIES.DUPLICATE,
      confidence: 0.99,
      reason: 'identical to an earlier email from the same sender',
      source: CATEGORY_SOURCES.HISTORY,
    };
    lines.push(`Identical to an earlier email from the same sender, subject ${quoted(original.subject)}.`);
  }

  const mentioned = queryIdsIn(message.subject, bodyText(message));
  const followUps = new Set();
  if (mentioned.length) {
    const found = await QueryCase.find({ queryId: { $in: mentioned } }).select('queryId subject businessStatus').lean();
    for (const known of found) {
      followUps.add(known.queryId);
      link({ kind: RELATION_KINDS.FOLLOW_UP, queryId: known.queryId });
      lines.push(`Refers to existing case ${known.queryId}, subject ${quoted(known.subject)}, status ${known.businessStatus}.`);
    }
  }

  for (const queryId of await threadCases(message)) {
    if (followUps.has(queryId)) continue;
    followUps.add(queryId);
    link({ kind: RELATION_KINDS.FOLLOW_UP, queryId });
    lines.push(`Same conversation thread as existing case ${queryId}.`);
  }

  const subject = normaliseSubject(message.subject);
  for (const known of cases) {
    if (followUps.has(known.queryId)) continue;
    if (!key || String(known.inquirer?.email || '').toLowerCase() !== key) continue;
    if (!subject || normaliseSubject(known.subject) !== subject) continue;
    followUps.add(known.queryId);
    link({ kind: RELATION_KINDS.FOLLOW_UP, queryId: known.queryId });
    lines.push(`Same sender and subject as existing case ${known.queryId}, status ${known.businessStatus}.`);
  }

  const mine = shingles(fingerprintText(message));
  const comparable = earlier.filter((candidate) => candidate.mailboxMessageId !== original?.mailboxMessageId);
  if (comparable.length) {
    const bodies = await MailboxMessage.find({ mailboxMessageId: { $in: comparable.map((candidate) => candidate.mailboxMessageId) } })
      .select('mailboxMessageId subject body bodyHtml')
      .lean();
    const best = bodies
      .map((other) => ({ other, score: jaccard(mine, shingles(fingerprintText(other))) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= SAME_SENDER_SIMILARITY) {
      const queryId = caseFor(best.other.mailboxMessageId)?.queryId ?? null;
      link({ kind: RELATION_KINDS.SAME_SENDER_SIMILAR, mailboxMessageId: best.other.mailboxMessageId, queryId, score: Number(best.score.toFixed(2)) });
      lines.push(
        `Very similar (${Math.round(best.score * 100)}%) to an earlier email from the same sender, subject ${quoted(best.other.subject)}` +
          (queryId ? `, registered as case ${queryId}.` : '.'),
      );
    }
  }

  const resembling = cases
    .filter((known) => !followUps.has(known.queryId) && String(known.inquirer?.email || '').toLowerCase() !== key)
    .map((known) => ({ known, score: jaccard(mine, known.shingles) }))
    .filter((entry) => entry.score >= CASE_SIMILARITY)
    .sort((a, b) => b.score - a.score)[0];
  if (resembling) {
    const { known, score } = resembling;
    link({ kind: RELATION_KINDS.RESEMBLES_CASE, queryId: known.queryId, score: Number(score.toFixed(2)) });
    lines.push(
      `Resembles case ${known.queryId} from a different inquirer, subject ${quoted(known.subject)}, status ${known.businessStatus}. ` +
        'A different sender asking something similar is a new query, not a duplicate.',
    );
  }

  const profile = senderProfile(earlier);
  if (profile.total) {
    const summary = Object.entries(profile.counts)
      .map(([category, count]) => `${count} ${label(category)}`)
      .join(', ');
    lines.push(`This sender sent ${profile.total} earlier email(s) in ${HISTORY_DAYS} days${summary ? `: ${summary}` : ''}.`);
  }

  const correction = earlier.find((candidate) => candidate.categorySource === CATEGORY_SOURCES.HUMAN && candidate.category);
  if (correction) lines.push(`The Front Office filed earlier mail from this sender under ${label(correction.category)}.`);

  return {
    senderKey: key,
    contentHash: hash,
    related,
    pinned,
    senderProfile: profile,
    senderCorrection: correction?.category ?? null,
    lines,
  };
}
