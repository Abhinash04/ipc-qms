import env from '../../../config/env.js';
import { isConnected } from '../../../config/db.js';
import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { MailboxTriage, RULE_CLASSES, TRIAGE_CLASSIFIERS, TRIAGE_VERDICTS } from '../../../models/MailboxTriage.js';
import * as audit from '../../audit/auditService.js';
import { AUDIT_ACTIONS } from '../../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import { classifyMail } from '../../ai/gemmaService.js';
import {
  CATEGORY_CONFIDENCE_FLOOR,
  CATEGORY_SOURCES,
  CATEGORY_VERSION,
  GENUINE_CATEGORIES,
  MAIL_CATEGORIES,
  MAIL_CATEGORY_INFO,
  isMailCategory,
} from '../../../constants/mailCategories.js';
import { categoryForRule, heuristicCategory } from './categoryHeuristics.js';
import { createHistoryContext, findRelated } from './mailHistory.js';
import { contentHash, senderKey } from './mailFingerprint.js';
import { findTriage, rescue } from './triage.js';

export const MAX_TRIAGE_ATTEMPTS = 12;

const CLASSIFY_CONCURRENCY = 4;

const SWEEP_BATCHES = 4;

export function classifyCandidateFilter() {
  return {
    gemmaAt: null,
    rescuedAt: null,
    purgedAt: null,
    ruleClass: { $in: [RULE_CLASSES.NONE, RULE_CLASSES.SOFT] },
    attempts: { $lt: MAX_TRIAGE_ATTEMPTS },
  };
}

export function categoryCandidateFilters() {
  const open = { purgedAt: null, categorySource: { $ne: CATEGORY_SOURCES.HUMAN } };
  return [
    { ...open, categorizedAt: null },
    { ...open, categoryVersion: { $lt: CATEGORY_VERSION } },
  ];
}

export function pendingFilter(ids = null) {
  return {
    $or: [classifyCandidateFilter(), ...categoryCandidateFilters()],
    ...(ids ? { mailboxMessageId: { $in: ids } } : {}),
  };
}

const verdictPending = (row) =>
  !row.gemmaAt &&
  !row.rescuedAt &&
  !row.purgedAt &&
  [RULE_CLASSES.NONE, RULE_CLASSES.SOFT].includes(row.ruleClass) &&
  (row.attempts || 0) < MAX_TRIAGE_ATTEMPTS;

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function settle({ category, confidence = 0, reason = '', source }) {
  if (!isMailCategory(category)) {
    return {
      category: MAIL_CATEGORIES.OTHER,
      categoryConfidence: 0,
      categoryReason: reason || 'could not be classified',
      categorySource: source,
      predictedCategory: null,
      predictedConfidence: 0,
      needsReview: true,
    };
  }

  if (confidence < CATEGORY_CONFIDENCE_FLOOR) {
    return {
      category: MAIL_CATEGORIES.OTHER,
      categoryConfidence: confidence,
      categoryReason:
        category === MAIL_CATEGORIES.OTHER ? reason : `unsure — looked like ${MAIL_CATEGORY_INFO[category].label}`,
      categorySource: source,
      predictedCategory: category,
      predictedConfidence: confidence,
      needsReview: true,
    };
  }

  return {
    category,
    categoryConfidence: confidence,
    categoryReason: reason,
    categorySource: source,
    predictedCategory: category,
    predictedConfidence: confidence,
    needsReview: false,
  };
}

const NO_HISTORY = Object.freeze({ related: [], pinned: null, senderProfile: null, senderCorrection: null, lines: [] });

async function historyFor(message, row, ctx) {
  try {
    return await findRelated(message, row, ctx);
  } catch (error) {
    console.warn(`[qms] categoriser: no history for ${row.mailboxMessageId}: ${error.message}`);
    return { ...NO_HISTORY, senderKey: senderKey(message.from), contentHash: contentHash(message) };
  }
}

async function writeCategory(row, settled, { history, message, nowIso }) {
  const result = await MailboxTriage.updateOne(
    { mailboxMessageId: row.mailboxMessageId, categorySource: { $ne: CATEGORY_SOURCES.HUMAN } },
    {
      $set: {
        ...settled,
        related: history.related,
        categorizedAt: nowIso,
        categoryVersion: CATEGORY_VERSION,
        senderKey: history.senderKey ?? row.senderKey ?? null,
        contentHash: history.contentHash ?? row.contentHash ?? null,
        receivedAt: row.receivedAt || message?.receivedAt || null,
      },
    },
  );
  if (result?.matchedCount) {
    await MailboxMessage.updateOne(
      { mailboxMessageId: row.mailboxMessageId },
      { $set: { mailCategory: settled.category } },
    );
  }
}

async function writeVerdict(row, verdict, nowIso) {
  const attempts = (row.attempts || 0) + 1;
  const answered = verdict.aiGenerated;
  const exhausted = !answered && attempts >= MAX_TRIAGE_ATTEMPTS;

  await MailboxTriage.updateOne(
    { mailboxMessageId: row.mailboxMessageId, rescuedAt: null },
    {
      $set: {
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reason: verdict.reason || row.reason || '',
        attempts,
        classifier: answered
          ? TRIAGE_CLASSIFIERS.GEMMA
          : exhausted
            ? TRIAGE_CLASSIFIERS.EXHAUSTED
            : TRIAGE_CLASSIFIERS.FALLBACK,
        ...(answered || exhausted ? { gemmaAt: nowIso } : {}),
      },
    },
  );

  if (verdict.verdict === TRIAGE_VERDICTS.JUNK && verdict.confidence > 0) {
    await audit.record({
      action: AUDIT_ACTIONS.EMAIL_CLASSIFIED,
      actorType: ACTOR_TYPES.SYSTEM,
      messageId: row.mailboxMessageId,
      details: {
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reason: verdict.reason,
        classifier: TRIAGE_CLASSIFIERS.GEMMA,
      },
    });
  }
}

async function categorizeRow(row, message, ctx, { now, dryRun }) {
  const nowIso = new Date(now).toISOString();
  const needsVerdict = verdictPending(row);
  const outcome = { mailboxMessageId: row.mailboxMessageId, verdictChecked: false, junk: false, category: null };

  if (!message) {
    if (!dryRun) {
      await MailboxTriage.updateOne(
        { mailboxMessageId: row.mailboxMessageId },
        {
          $set: {
            ...(needsVerdict ? { gemmaAt: nowIso, classifier: TRIAGE_CLASSIFIERS.EXHAUSTED } : {}),
            ...(row.categorySource === CATEGORY_SOURCES.HUMAN
              ? {}
              : {
                  ...settle({ category: null, reason: 'the message is no longer stored', source: CATEGORY_SOURCES.FALLBACK }),
                  categorizedAt: nowIso,
                  categoryVersion: CATEGORY_VERSION,
                }),
          },
        },
      );
    }
    return outcome;
  }

  const history = await historyFor(message, row, ctx);
  const signals = row.reason ? [row.reason] : [];
  const ruled = row.ruleClass === RULE_CLASSES.HARD ? categoryForRule(row.rule) : null;

  let verdict = null;
  let proposal;
  if (ruled) {
    proposal = { ...ruled, source: CATEGORY_SOURCES.RULES };
  } else {
    verdict = env.GEMMA_API_URL
      ? await classifyMail({
          from: message.from,
          subject: message.subject,
          body: message.body,
          attachments: message.attachments,
          signals,
          history: history.lines,
        })
      : null;
    proposal =
      verdict?.aiGenerated && verdict.category
        ? {
            category: verdict.category,
            confidence: verdict.categoryConfidence,
            reason: verdict.categoryReason,
            source: CATEGORY_SOURCES.GEMMA,
          }
        : { ...heuristicCategory(message, { signals, history }), source: CATEGORY_SOURCES.FALLBACK };
  }
  if (history.pinned) proposal = history.pinned;

  const settled = settle(proposal);
  outcome.category = settled.category;
  outcome.verdictChecked = Boolean(needsVerdict && verdict);
  outcome.junk = Boolean(outcome.verdictChecked && verdict.verdict === TRIAGE_VERDICTS.JUNK && verdict.confidence > 0);
  if (dryRun) return outcome;

  if (outcome.verdictChecked) await writeVerdict(row, verdict, nowIso);
  if (row.categorySource !== CATEGORY_SOURCES.HUMAN) await writeCategory(row, settled, { history, message, nowIso });
  return outcome;
}

async function categorizeBatch({ ids = null, limit = env.MAILBOX_TRIAGE_BATCH, now = Date.now(), dryRun = false } = {}) {
  const empty = { picked: 0, classified: 0, junk: 0, categorized: 0 };
  if (!isConnected() || (ids && !ids.length)) return empty;

  const rows = await MailboxTriage.find(pendingFilter(ids))
    .select('mailboxMessageId from subject reason rule ruleClass attempts gemmaAt rescuedAt purgedAt receivedAt senderKey contentHash categorySource')
    .sort({ classifiedAt: 1 })
    .limit(limit)
    .lean();
  if (!rows.length) return empty;

  const messages = await MailboxMessage.find({ mailboxMessageId: { $in: rows.map((row) => row.mailboxMessageId) } })
    .select('mailboxMessageId from subject body bodyHtml attachments receivedAt providerThreadId source')
    .lean();
  const byId = new Map(messages.map((message) => [message.mailboxMessageId, message]));
  const ctx = createHistoryContext();

  const outcomes = await mapWithLimit(rows, CLASSIFY_CONCURRENCY, async (row) => {
    try {
      return await categorizeRow(row, byId.get(row.mailboxMessageId), ctx, { now, dryRun });
    } catch (error) {
      console.warn(`[qms] categoriser: could not categorise ${row.mailboxMessageId}: ${error.message}`);
      return null;
    }
  });

  const done = outcomes.filter(Boolean);
  return {
    picked: rows.length,
    classified: done.filter((outcome) => outcome.verdictChecked).length,
    junk: done.filter((outcome) => outcome.junk).length,
    categorized: done.filter((outcome) => outcome.category).length,
  };
}

let tail = Promise.resolve();

function exclusive(task) {
  const run = tail.then(task);
  tail = run.catch(() => {});
  return run;
}

export function categorizePending(options = {}) {
  return exclusive(() => categorizeBatch(options));
}

export async function categorizeBacklog({ now = Date.now(), dryRun = false, limit = env.MAILBOX_TRIAGE_BATCH } = {}) {
  const total = { picked: 0, classified: 0, junk: 0, categorized: 0 };
  for (let batch = 0; batch < SWEEP_BATCHES; batch += 1) {
    const result = await categorizePending({ now, dryRun, limit });
    for (const key of Object.keys(total)) total[key] += result[key];
    if (dryRun || result.picked < limit) break;
  }
  return total;
}

const queued = new Set();
let draining = null;

function schedule() {
  if (draining || !queued.size) return;
  draining = exclusive(async () => {
    while (queued.size) {
      const batch = [...queued];
      queued.clear();
      try {
        await categorizeBatch({ ids: batch, limit: batch.length });
      } catch (error) {
        console.warn(`[qms] categoriser: could not categorise new mail: ${error.message}`);
      }
    }
  }).finally(() => {
    draining = null;
    schedule();
  });
}

export function kick(ids = []) {
  if (!ids.length || !isConnected()) return;
  for (const id of ids) queued.add(id);
  schedule();
}

export async function idle() {
  while (draining) await draining;
  await tail;
}

let backfilled = false;

export async function backfillMissingRows({ sources, now = Date.now() } = {}) {
  if (backfilled || !isConnected() || !sources?.length) return 0;

  const messages = await MailboxMessage.find({ source: { $in: sources }, purgedAt: null, removedAt: null })
    .select('mailboxMessageId')
    .lean();
  const ids = messages.map((message) => message.mailboxMessageId);
  const known = new Set(
    (await MailboxTriage.find({ mailboxMessageId: { $in: ids } }).select('mailboxMessageId').lean()).map(
      (row) => row.mailboxMessageId,
    ),
  );
  const missing = ids.filter((id) => !known.has(id));

  let created = 0;
  if (missing.length) {
    const nowIso = new Date(now).toISOString();
    const rows = await MailboxMessage.find({ mailboxMessageId: { $in: missing } })
      .select('mailboxMessageId source from subject body bodyHtml attachments receivedAt')
      .lean();
    for (const message of rows) {
      const result = await MailboxTriage.updateOne(
        { mailboxMessageId: message.mailboxMessageId },
        {
          $setOnInsert: {
            mailboxMessageId: message.mailboxMessageId,
            verdict: TRIAGE_VERDICTS.GENUINE,
            confidence: 0,
            classifier: TRIAGE_CLASSIFIERS.RULES,
            rule: null,
            ruleClass: RULE_CLASSES.NONE,
            reason: '',
            classifiedAt: nowIso,
            gemmaAt: nowIso,
            attempts: 0,
            rescuedAt: null,
            rescuedByUserId: null,
            purgedAt: null,
            source: message.source,
            from: message.from || '',
            subject: message.subject || '',
            receivedAt: message.receivedAt || null,
            senderKey: senderKey(message.from),
            contentHash: contentHash(message),
            category: null,
            categorizedAt: null,
            categoryVersion: 0,
            createdAt: nowIso,
          },
        },
        { upsert: true },
      );
      created += result?.upsertedCount ? 1 : 0;
    }
  }

  backfilled = true;
  return created;
}

export function resetCategorizer() {
  backfilled = false;
  queued.clear();
  draining = null;
  tail = Promise.resolve();
}

export async function correctCategory(message, category, { userId = null, role = null, now = new Date() } = {}) {
  if (!isConnected()) return null;
  const id = message.mailboxMessageId;
  const nowIso = now.toISOString();
  const before = await MailboxTriage.findOne({ mailboxMessageId: id }).lean();

  await MailboxTriage.updateOne(
    { mailboxMessageId: id },
    {
      $set: {
        category,
        categorySource: CATEGORY_SOURCES.HUMAN,
        categoryCorrectedAt: nowIso,
        categoryCorrectedByUserId: userId,
        needsReview: false,
        categorizedAt: before?.categorizedAt || nowIso,
        categoryVersion: CATEGORY_VERSION,
      },
      $setOnInsert: {
        mailboxMessageId: id,
        verdict: TRIAGE_VERDICTS.GENUINE,
        confidence: 0,
        classifier: TRIAGE_CLASSIFIERS.HUMAN,
        rule: null,
        ruleClass: RULE_CLASSES.NONE,
        reason: '',
        classifiedAt: nowIso,
        gemmaAt: nowIso,
        attempts: 0,
        purgedAt: null,
        source: message.source ?? null,
        from: message.from || '',
        subject: message.subject || '',
        receivedAt: message.receivedAt || null,
        senderKey: senderKey(message.from),
        contentHash: contentHash(message),
        createdAt: nowIso,
      },
    },
    { upsert: true },
  );
  await MailboxMessage.updateOne({ mailboxMessageId: id }, { $set: { mailCategory: category } });

  const protects = GENUINE_CATEGORIES.includes(category);
  const rescued = Boolean(protects && before?.verdict === TRIAGE_VERDICTS.JUNK && !before?.rescuedAt);
  if (rescued) await rescue(id, { userId, now });

  await audit.record({
    action: AUDIT_ACTIONS.EMAIL_CLASSIFIED,
    actorType: ACTOR_TYPES.HUMAN,
    actorId: userId,
    actorRole: role,
    messageId: id,
    details: {
      category,
      previous: before?.category ?? null,
      predicted: before?.predictedCategory ?? null,
      corrected: true,
      rescued,
      from: message.from ?? null,
      subject: message.subject ?? null,
    },
  });

  return findTriage(id);
}
