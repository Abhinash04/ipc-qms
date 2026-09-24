import env from '../../../config/env.js';
import { isConnected, isSharedDatabase } from '../../../config/db.js';
import browserConfig from '../../../config/browserConfig.js';
import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { MailboxDecision } from '../../../models/MailboxDecision.js';
import { MailboxTriage, RULE_CLASSES, TRIAGE_CLASSIFIERS, TRIAGE_VERDICTS } from '../../../models/MailboxTriage.js';
import { QueryCase } from '../../../models/QueryCase.js';
import * as attachmentStore from '../../attachments/attachmentStore.js';
import * as audit from '../../audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import { classifyMail } from '../../ai/gemmaService.js';

export const PURGEABLE_SOURCES = ['nic-browser'];

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const RETENTION_GRACE_MS = 2 * 60 * 60 * 1000;

const MAX_TRIAGE_ATTEMPTS = 12;

const CLASSIFY_CONCURRENCY = 4;

let timer = null;
let firstPass = null;
let inFlight = null;
let bootedAt = Date.now();

const hoursToMs = (hours) => hours * 60 * 60 * 1000;

export function purgeCandidateFilter({
  now = Date.now(),
  retentionHours = env.MAILBOX_RETENTION_HOURS,
  confidenceFloor = env.MAILBOX_JUNK_CONFIDENCE,
} = {}) {
  return {
    verdict: TRIAGE_VERDICTS.JUNK,
    purgedAt: null,
    rescuedAt: null,
    classifiedAt: { $lt: new Date(now - hoursToMs(retentionHours)).toISOString() },
    confidence: { $gte: confidenceFloor },
  };
}

export function rejectedCandidateFilter({ now = Date.now(), retentionHours = env.MAILBOX_RETENTION_HOURS } = {}) {
  return {
    decision: 'REJECTED',
    decidedAt: { $lt: new Date(now - hoursToMs(retentionHours)).toISOString() },
  };
}

export function unregisteredCandidateFilter({
  now = Date.now(),
  unregisteredHours = env.MAILBOX_UNREGISTERED_RETENTION_HOURS,
} = {}) {
  return {
    purgedAt: null,
    rescuedAt: null,
    classifiedAt: { $lt: new Date(now - hoursToMs(unregisteredHours)).toISOString() },
  };
}

export function purgeMessageFilter(ids) {
  return {
    mailboxMessageId: { $in: ids },
    source: { $in: PURGEABLE_SOURCES },
    purgedAt: null,
  };
}

export function classifyCandidateFilter() {
  return {
    gemmaAt: null,
    rescuedAt: null,
    purgedAt: null,
    ruleClass: { $in: [RULE_CLASSES.NONE, RULE_CLASSES.SOFT] },
    attempts: { $lt: MAX_TRIAGE_ATTEMPTS },
  };
}

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

export async function classifyPending({ now = Date.now(), limit = env.MAILBOX_TRIAGE_BATCH, dryRun = false } = {}) {
  if (!isConnected() || !env.GEMMA_API_URL) return { classified: 0, junk: 0 };

  const rows = await MailboxTriage.find(classifyCandidateFilter())
    .select('mailboxMessageId from subject reason rule ruleClass attempts')
    .sort({ classifiedAt: 1 })
    .limit(limit)
    .lean();
  if (!rows.length) return { classified: 0, junk: 0 };

  const messages = await MailboxMessage.find({
    mailboxMessageId: { $in: rows.map((row) => row.mailboxMessageId) },
  })
    .select('mailboxMessageId from subject body attachments')
    .lean();
  const bodies = new Map(messages.map((message) => [message.mailboxMessageId, message]));

  let junk = 0;
  let classified = 0;

  await mapWithLimit(rows, CLASSIFY_CONCURRENCY, async (row) => {
    const message = bodies.get(row.mailboxMessageId);
    if (!message) {
      if (!dryRun) {
        await MailboxTriage.updateOne(
          { mailboxMessageId: row.mailboxMessageId },
          { $set: { gemmaAt: new Date(now).toISOString(), classifier: TRIAGE_CLASSIFIERS.EXHAUSTED } },
        );
      }
      return;
    }

    const verdict = await classifyMail({
      from: message.from,
      subject: message.subject,
      body: message.body,
      attachments: message.attachments,
      signals: row.reason ? [row.reason] : [],
    });

    classified += 1;
    if (verdict.verdict === TRIAGE_VERDICTS.JUNK && verdict.confidence > 0) junk += 1;
    if (dryRun) return;

    const nowIso = new Date(now).toISOString();
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
  });

  return { classified, junk };
}

export async function findPurgeable({
  now = Date.now(),
  limit = env.MAILBOX_PURGE_BATCH,
  retentionHours,
  unregisteredHours,
} = {}) {
  const [junk, rejected, unregistered] = await Promise.all([
    MailboxTriage.find(purgeCandidateFilter({ now, retentionHours }))
      .select('mailboxMessageId verdict confidence classifier rule classifiedAt')
      .sort({ classifiedAt: 1 })
      .limit(limit)
      .lean(),
    MailboxDecision.find(rejectedCandidateFilter({ now, retentionHours }))
      .select('mailboxMessageId decidedAt')
      .sort({ decidedAt: 1 })
      .limit(limit)
      .lean(),
    MailboxTriage.find(unregisteredCandidateFilter({ now, unregisteredHours }))
      .select('mailboxMessageId verdict confidence classifier rule classifiedAt')
      .sort({ classifiedAt: 1 })
      .limit(limit)
      .lean(),
  ]);

  const candidates = new Map();
  for (const row of junk) {
    candidates.set(row.mailboxMessageId, {
      mailboxMessageId: row.mailboxMessageId,
      why: 'machine-junk',
      verdict: row.verdict,
      confidence: row.confidence,
      classifier: row.classifier,
      rule: row.rule,
      since: row.classifiedAt,
    });
  }
  for (const row of rejected) {
    if (candidates.has(row.mailboxMessageId)) continue;
    candidates.set(row.mailboxMessageId, {
      mailboxMessageId: row.mailboxMessageId,
      why: 'human-rejected',
      verdict: null,
      confidence: null,
      classifier: null,
      rule: null,
      since: row.decidedAt,
    });
  }
  for (const row of unregistered) {
    if (candidates.has(row.mailboxMessageId)) continue;
    candidates.set(row.mailboxMessageId, {
      mailboxMessageId: row.mailboxMessageId,
      why: 'unregistered-expired',
      verdict: row.verdict,
      confidence: row.confidence,
      classifier: row.classifier,
      rule: row.rule,
      since: row.classifiedAt,
    });
  }

  return [...candidates.values()].slice(0, limit);
}

async function vetoFor(mailboxMessageId) {
  const accepted = await MailboxDecision.findOne({ mailboxMessageId, decision: 'ACCEPTED' }).select('_id').lean();
  if (accepted) return 'accepted';

  const linked = await QueryCase.findOne({ sourceMailboxMessageId: mailboxMessageId }).select('_id').lean();
  if (linked) return 'linkedCase';

  return null;
}

export async function purgeOne(row, { now = Date.now(), dryRun = false } = {}) {
  const nowIso = new Date(now).toISOString();
  let attachmentsRemoved = 0;

  for (const attachment of row.attachments ?? []) {
    const id = attachment?.attachmentId;
    if (!id) continue;
    if (dryRun) {
      attachmentsRemoved += 1;
      continue;
    }
    try {
      await attachmentStore.remove(id);
      attachmentsRemoved += 1;
    } catch (error) {
      console.warn(`[qms] retention: could not remove attachment ${id}: ${error.message}`);
    }
  }

  if (!dryRun) {
    await MailboxMessage.updateOne(
      { mailboxMessageId: row.mailboxMessageId, purgedAt: null },
      {
        $set: {
          body: '',
          bodyHtml: null,
          attachments: [],
          aiSummary: null,
          purgedAt: nowIso,
          removedAt: row.removedAt ?? nowIso,
        },
      },
    );

    await MailboxTriage.updateOne({ mailboxMessageId: row.mailboxMessageId }, { $set: { purgedAt: nowIso } });
  }

  return { attachmentsRemoved };
}

export async function sweepOnce({
  now = Date.now(),
  dryRun = false,
  retentionHours,
  unregisteredHours,
  limit = env.MAILBOX_PURGE_BATCH,
  classify = true,
  purge = true,
  ignoreGrace = false,
} = {}) {
  const started = Date.now();
  const result = {
    scanned: 0,
    classified: 0,
    purged: 0,
    attachmentsRemoved: 0,
    skipped: { accepted: 0, linkedCase: 0, notEligible: 0 },
    errors: [],
    durationMs: 0,
    grace: false,
  };

  if (!isConnected()) return { ...result, durationMs: Date.now() - started };

  try {
    if (classify) {
      const classified = await classifyPending({ now, dryRun });
      result.classified = classified.classified;
    }

    if (!purge) return { ...result, durationMs: Date.now() - started };

    if (!ignoreGrace && Date.now() - bootedAt < RETENTION_GRACE_MS) {
      return { ...result, grace: true, durationMs: Date.now() - started };
    }

    const candidates = await findPurgeable({ now, limit, retentionHours, unregisteredHours });
    result.scanned = candidates.length;
    if (!candidates.length) return { ...result, durationMs: Date.now() - started };

    const byId = new Map(candidates.map((candidate) => [candidate.mailboxMessageId, candidate]));
    const rows = await MailboxMessage.find(purgeMessageFilter([...byId.keys()]))
      .select('mailboxMessageId source from subject receivedAt attachments removedAt')
      .lean();

    result.skipped.notEligible = candidates.length - rows.length;

    for (const row of rows) {
      const candidate = byId.get(row.mailboxMessageId);
      try {
        const veto = await vetoFor(row.mailboxMessageId);
        if (veto) {
          result.skipped[veto] += 1;
          continue;
        }

        const { attachmentsRemoved } = await purgeOne(row, { now, dryRun });
        result.purged += 1;
        result.attachmentsRemoved += attachmentsRemoved;

        if (!dryRun) {
          await audit.record({
            action: AUDIT_ACTIONS.EMAIL_PURGED,
            actorType: ACTOR_TYPES.SYSTEM,
            result: AUDIT_RESULTS.SUCCESS,
            messageId: row.mailboxMessageId,
            details: {
              source: row.source,
              reason: candidate?.why,
              verdict: candidate?.verdict,
              confidence: candidate?.confidence,
              classifier: candidate?.classifier,
              rule: candidate?.rule,
              ageHours: candidate?.since
                ? Math.round((now - Date.parse(candidate.since)) / 3600000)
                : null,
              attachmentsRemoved,
              from: row.from,
              subject: row.subject,
              receivedAt: row.receivedAt,
            },
          });
        }
      } catch (error) {
        result.errors.push(`${row.mailboxMessageId}: ${error.message}`);
      }
    }

    if (!dryRun && result.purged > 0) {
      await audit.record({
        action: AUDIT_ACTIONS.EMAIL_PURGED,
        actorType: ACTOR_TYPES.SYSTEM,
        result: result.errors.length ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
        details: {
          summary: true,
          purged: result.purged,
          attachmentsRemoved: result.attachmentsRemoved,
          skipped: result.skipped,
          retentionHours: retentionHours ?? env.MAILBOX_RETENTION_HOURS,
          unregisteredHours: unregisteredHours ?? env.MAILBOX_UNREGISTERED_RETENTION_HOURS,
        },
      });
    }
  } catch (error) {
    result.errors.push(error.message);
    console.warn(`[qms] retention sweep failed: ${error.message}`);
  }

  return { ...result, durationMs: Date.now() - started };
}

async function runSweep(options = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      return await sweepOnce(options);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function startRetentionSweeps(options = {}) {
  if (env.NODE_ENV === 'test') return null;
  if (!env.MAILBOX_RETENTION_ENABLED) return null;
  const mailboxHost = browserConfig.mailboxEnabled && !browserConfig.mailboxViewer;
  if (isSharedDatabase() && env.NODE_ENV !== 'production' && !mailboxHost) return null;
  if (timer) return timer;

  bootedAt = options.bootedAt ?? Date.now();

  timer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  firstPass = setTimeout(() => {
    void runSweep();
  }, 5 * 60 * 1000);
  firstPass.unref();

  return timer;
}

export function stopRetentionSweeps() {
  if (timer) clearInterval(timer);
  if (firstPass) clearTimeout(firstPass);
  timer = null;
  firstPass = null;
}

export function setBootedAt(value) {
  bootedAt = value;
}

export default { sweepOnce, startRetentionSweeps, stopRetentionSweeps, PURGEABLE_SOURCES };
