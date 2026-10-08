import { isConnected } from '../../../config/db.js';

import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { CATEGORY_SOURCES, CATEGORY_VERSION } from '../../../constants/mailCategories.js';
import {
  MailboxTriage,
  RULE_CLASSES,
  TRIAGE_CLASSIFIERS,
  TRIAGE_VERDICTS,
} from '../../../models/MailboxTriage.js';
import { classifyByRules } from './triageRules.js';
import { categoryForRule } from './categoryHeuristics.js';
import { contentHash, senderKey } from './mailFingerprint.js';

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

const confidenceFor = (ruleClass) => (ruleClass === RULE_CLASSES.HARD ? 1 : 0);

async function recordRules(mailboxMessageId, message = {}, { source = null, now = new Date() } = {}) {
  if (!mailboxMessageId || !isConnected()) return null;

  try {
    const result = classifyByRules({
      from: message.from,
      subject: message.subject,
      body: message.body,
      bodyHtml: message.bodyHtml,
      attachments: message.attachments,
      headers: message.headers ?? null,
    });

    const nowIso = now.toISOString();
    const isHard = result.ruleClass === RULE_CLASSES.HARD;
    const ruled = isHard ? categoryForRule(result.rule) : null;

    const written = await MailboxTriage.updateOne(
      { mailboxMessageId },
      {
        $setOnInsert: {
          mailboxMessageId,
          verdict: result.verdict,
          confidence: confidenceFor(result.ruleClass),
          classifier: TRIAGE_CLASSIFIERS.RULES,
          rule: result.rule,
          ruleClass: result.ruleClass,
          reason: result.reason,
          classifiedAt: nowIso,
          gemmaAt: isHard ? nowIso : null,
          attempts: 0,
          rescuedAt: null,
          rescuedByUserId: null,
          purgedAt: null,
          source,
          from: message.from || '',
          subject: message.subject || '',
          receivedAt: message.receivedAt || null,
          senderKey: senderKey(message.from),
          contentHash: contentHash(message),
          category: ruled?.category ?? null,
          categoryConfidence: ruled?.confidence ?? 0,
          categoryReason: ruled?.reason ?? '',
          categorySource: ruled ? CATEGORY_SOURCES.RULES : null,
          categorizedAt: ruled ? nowIso : null,
          categoryVersion: ruled ? CATEGORY_VERSION : 0,
          predictedCategory: ruled?.category ?? null,
          predictedConfidence: ruled?.confidence ?? 0,
          needsReview: false,
          related: [],
          createdAt: nowIso,
        },
      },
      { upsert: true },
    );

    if (ruled && written?.upsertedCount) {
      await MailboxMessage.updateOne({ mailboxMessageId }, { $set: { mailCategory: ruled.category } });
    }

    return { ...result, confidence: confidenceFor(result.ruleClass) };
  } catch (error) {
    if (error?.code !== 11000) {
      console.warn(`[qms] triage: could not classify ${mailboxMessageId}: ${error.message}`);
    }
    return null;
  }
}

async function rescue(mailboxMessageId, { userId = null, now = new Date() } = {}) {
  if (!isConnected()) return null;
  const nowIso = now.toISOString();

  const updated = await MailboxTriage.findOneAndUpdate(
    { mailboxMessageId },
    {
      $set: {
        verdict: TRIAGE_VERDICTS.GENUINE,
        confidence: 0,
        classifier: TRIAGE_CLASSIFIERS.HUMAN,
        rescuedAt: nowIso,
        rescuedByUserId: userId,
        reason: '',
      },
      $setOnInsert: {
        mailboxMessageId,
        rule: null,
        ruleClass: RULE_CLASSES.NONE,
        classifiedAt: nowIso,
        gemmaAt: nowIso,
        attempts: 0,
        purgedAt: null,
        createdAt: nowIso,
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();

  return toPlain(updated);
}

async function findTriage(mailboxMessageId) {
  if (!isConnected()) return null;
  return toPlain(await MailboxTriage.findOne({ mailboxMessageId }).lean());
}

async function findTriages(mailboxMessageIds) {
  if (!mailboxMessageIds?.length || !isConnected()) return new Map();
  const rows = await MailboxTriage.find({ mailboxMessageId: { $in: mailboxMessageIds } }).lean();
  return new Map(rows.map((row) => [row.mailboxMessageId, toPlain(row)]));
}

async function junkMessageIds({ limit = 500 } = {}) {
  if (!isConnected()) return [];
  const rows = await MailboxTriage.find({ verdict: TRIAGE_VERDICTS.JUNK, rescuedAt: null })
    .select('mailboxMessageId')
    .sort({ classifiedAt: -1 })
    .limit(limit)
    .lean();
  return rows.map((row) => row.mailboxMessageId);
}

export { recordRules, rescue, findTriage, findTriages, junkMessageIds };
export default { recordRules, rescue, findTriage, findTriages, junkMessageIds };
