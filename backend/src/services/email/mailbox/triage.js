import { isConnected } from '../../../config/db.js';

import {
  MailboxTriage,
  RULE_CLASSES,
  TRIAGE_CLASSIFIERS,
  TRIAGE_VERDICTS,
} from '../../../models/MailboxTriage.js';
import { classifyByRules } from './triageRules.js';

/**
 * Writing and reading the machine's verdict on a message.
 *
 * `recordRules` runs on the intake path, inside the sync's read loop, so it is
 * built never to throw — a throw there aborts the read and costs the whole
 * batch. That is a property of this module rather than something each caller
 * has to remember to wrap, which is the contract auditService.record keeps for
 * the same reason.
 *
 * The model phase does NOT live here: it runs in the retention sweep, where it
 * is naturally rate-limited and adds latency to no request. See retention.js.
 */

const toPlain = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
};

/** A hard rule is certain by construction; a soft one carries no weight of its own. */
const confidenceFor = (ruleClass) => (ruleClass === RULE_CLASSES.HARD ? 1 : 0);

/**
 * Record the deterministic verdict for a freshly stored message.
 *
 * A row is written for EVERY stored message, GENUINE by default — not only for
 * junk. The model phase queries this collection, and finding "messages with no
 * triage row" from the other side would need a `$nin` of every id ever written.
 *
 * `$setOnInsert`, so a re-sync of the same message never resets a verdict the
 * model has since refined or a person has since rescued.
 */
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

    await MailboxTriage.updateOne(
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
          // A hard rule is terminal: the model is never asked, so the row is
          // stamped as already answered and the model phase skips it.
          gemmaAt: isHard ? nowIso : null,
          attempts: 0,
          rescuedAt: null,
          rescuedByUserId: null,
          purgedAt: null,
          source,
          from: message.from || '',
          subject: message.subject || '',
          receivedAt: message.receivedAt || null,
          createdAt: nowIso,
        },
      },
      { upsert: true },
    );

    return { ...result, confidence: confidenceFor(result.ruleClass) };
  } catch (error) {
    // Two syncs racing on the same message: the other one wrote it.
    if (error?.code !== 11000) {
      console.warn(`[qms] triage: could not classify ${mailboxMessageId}: ${error.message}`);
    }
    return null;
  }
}

/**
 * A person says this is not junk. Terminal — the model phase skips a rescued
 * row and the sweep's candidate query excludes it, so nothing reclassifies or
 * purges it afterwards.
 *
 * Without this the only way to save junk would be to accept it, which mints a
 * Query Case nobody asked for.
 */
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

/** The verdicts on these messages, by message id — one query for a whole inbox page. */
async function findTriages(mailboxMessageIds) {
  if (!mailboxMessageIds?.length || !isConnected()) return new Map();
  const rows = await MailboxTriage.find({ mailboxMessageId: { $in: mailboxMessageIds } }).lean();
  return new Map(rows.map((row) => [row.mailboxMessageId, toPlain(row)]));
}

/**
 * The ids currently held to be junk in one mailbox, newest verdict first.
 *
 * Capped: this feeds a `$in` on the message query, and an unbounded one is a
 * real failure mode once a mailbox has seen years of marketing.
 */
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
