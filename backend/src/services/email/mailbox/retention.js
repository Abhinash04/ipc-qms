import env from '../../../config/env.js';
import { isConnected } from '../../../config/db.js';
import { MailboxMessage } from '../../../models/MailboxMessage.js';
import { MailboxDecision } from '../../../models/MailboxDecision.js';
import { MailboxTriage, RULE_CLASSES, TRIAGE_CLASSIFIERS, TRIAGE_VERDICTS } from '../../../models/MailboxTriage.js';
import { QueryCase } from '../../../models/QueryCase.js';
import * as attachmentStore from '../../attachments/attachmentStore.js';
import * as audit from '../../audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
import { classifyMail } from '../../ai/gemmaService.js';

/**
 * Junk retention: ask the model about what the rules were unsure of, then strip
 * the content of anything still held to be junk once it is old enough.
 *
 * Not a delete, and not a TTL index. A TTL index can only remove a whole
 * document, and the id stub is what stops the next sync re-ingesting the
 * message — nicBrowserMailbox builds its skip-set from stored
 * `providerMessageId`s. So this strips the heavy fields and leaves the stub.
 *
 * No aggregation pipeline anywhere in this file. The test harness's in-memory
 * Mongo stand-in has no `aggregate` and throws on operators outside its
 * allow-list, and two small queries plus point lookups is also the right shape
 * for a 512MB shared cluster.
 *
 * Must not import nicBrowserMailbox.js — that module may only be loaded on
 * demand — so the purgeable source is named here, exactly as mongoIpcMailbox.js
 * names its own scope and for the same reason.
 */

/**
 * An allow-list, not the inverse of mongoIpcMailbox's `$ne` scope. Only the
 * NICeMail browser mailbox stores rows at all; and `mongoIpcMailbox.list` does
 * not filter on `removedAt`, so tombstoning a `local` development row would
 * leave a body-less message still listed in that inbox.
 */
export const PURGEABLE_SOURCES = ['nic-browser'];

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Nothing is purged in the first hours after boot.
 *
 * The retention window is wall-clock, but the rescue window only exists while
 * somebody can see the inbox. Without this, a server restarted after a two-day
 * outage would purge its whole backlog on the first sweep, having given nobody
 * a live moment to look — which is exactly the failure the window exists to
 * prevent. The operator's deliberate override is the script's `--hours`.
 */
const RETENTION_GRACE_MS = 2 * 60 * 60 * 1000;

/** Asked this many times without a usable answer, a message is left GENUINE for good. */
const MAX_TRIAGE_ATTEMPTS = 12;

/** Matches DRAFT_CONCURRENCY in gemmaService: the same endpoint, the same courtesy. */
const CLASSIFY_CONCURRENCY = 4;

let timer = null;
let firstPass = null;
let inFlight = null;
let bootedAt = Date.now();

const hoursToMs = (hours) => hours * 60 * 60 * 1000;

// ── Filters (pure, so they can be asserted directly) ─────────────────────────

/**
 * Junk old enough to purge.
 *
 * `confidence: { $gte: floor }` is the whole "a Gemma outage can never cause a
 * wrong purge" guarantee, and it needs no code to enforce: every failure path
 * in classifyMail returns GENUINE at confidence 0, which this cannot reach.
 */
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

/** Rejections old enough to purge. A person already said this is not a case. */
export function rejectedCandidateFilter({ now = Date.now(), retentionHours = env.MAILBOX_RETENTION_HOURS } = {}) {
  return {
    decision: 'REJECTED',
    decidedAt: { $lt: new Date(now - hoursToMs(retentionHours)).toISOString() },
  };
}

/**
 * The messages those candidates point at.
 *
 * Three things are deliberately absent, each covered by a named test so that a
 * later reader does not "fix" them:
 *
 *   no `readAt: null`    — reading is not rescuing. An officer who opens junk
 *                          to confirm it is junk has read it, and guarding on
 *                          this would make diligently-checked junk immortal.
 *   no `removedAt: null` — a message a person deleted still carries its full
 *                          body. It is the best candidate here, not an excluded
 *                          one. `purgedAt` is the idempotency marker instead.
 *   no `ingested` clause — that field means "swept", and under Gmail it is
 *                          literally the UNREAD label. Far too overloaded to
 *                          carry a safety guarantee.
 */
export function purgeMessageFilter(ids) {
  return {
    mailboxMessageId: { $in: ids },
    source: { $in: PURGEABLE_SOURCES },
    purgedAt: null,
  };
}

/** Rows the model has not answered for yet. */
export function classifyCandidateFilter() {
  return {
    gemmaAt: null,
    rescuedAt: null,
    purgedAt: null,
    ruleClass: { $in: [RULE_CLASSES.NONE, RULE_CLASSES.SOFT] },
    attempts: { $lt: MAX_TRIAGE_ATTEMPTS },
  };
}

// ── The model phase ──────────────────────────────────────────────────────────

/** Ordered concurrency, mirroring gemmaService's mapWithLimit. */
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

/**
 * Ask the model about rows the rules could not settle.
 *
 * Runs here rather than on intake or on inbox read: intake is a CDP sync loop
 * polled every 30 seconds and a 12-second call per message would wreck it, and
 * inbox read is polled every few seconds at fifty rows a page. Here it is one
 * batch an hour, and a message gets roughly forty-five attempts inside a
 * forty-six hour window.
 */
export async function classifyPending({ now = Date.now(), limit = env.MAILBOX_TRIAGE_BATCH, dryRun = false } = {}) {
  if (!isConnected() || !env.GEMMA_API_URL) return { classified: 0, junk: 0 };

  const rows = await MailboxTriage.find(classifyCandidateFilter())
    .select('mailboxMessageId from subject reason rule ruleClass attempts')
    .sort({ classifiedAt: 1 })
    .limit(limit)
    .lean();
  if (!rows.length) return { classified: 0, junk: 0 };

  // The bodies, fetched only for the handful being classified. `bodyHtml` is
  // never read — it can be a megabyte, and the plain body is what the model
  // needs.
  const messages = await MailboxMessage.find({
    mailboxMessageId: { $in: rows.map((row) => row.mailboxMessageId) },
  })
    // `attachments` is in the projection because the model needs to know one
    // exists: a "please see attached" enquiry reaches it as a blank message
    // otherwise, and was condemned 3 times out of 3 before this was passed.
    // `bodyHtml` stays out — it can be a megabyte.
    .select('mailboxMessageId from subject body attachments')
    .lean();
  const bodies = new Map(messages.map((message) => [message.mailboxMessageId, message]));

  let junk = 0;
  let classified = 0;

  await mapWithLimit(rows, CLASSIFY_CONCURRENCY, async (row) => {
    const message = bodies.get(row.mailboxMessageId);
    // A triage row whose message is gone: nothing to classify, and leaving
    // `gemmaAt` null would make it a candidate forever.
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
      // What the rules noticed, handed over as facts rather than as a verdict.
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
          // Only a real answer, or giving up, stops the retries. A model that
          // could not be reached leaves this null and is asked again next hour.
          ...(answered || exhausted ? { gemmaAt: nowIso } : {}),
        },
      },
    );

    // Only a junk verdict is audited. A row per inbound message would land in
    // the same 512MB budget this feature exists to protect.
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

// ── The purge phase ──────────────────────────────────────────────────────────

/** Everything old enough to purge, from the small collections only. */
export async function findPurgeable({ now = Date.now(), limit = env.MAILBOX_PURGE_BATCH, retentionHours } = {}) {
  const [junk, rejected] = await Promise.all([
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

  return [...candidates.values()].slice(0, limit);
}

/**
 * The absolute vetoes, re-checked immediately before the update rather than
 * only when the candidate was selected.
 *
 * This closes a real race. acceptMessage reads the stored row and copies its
 * `body` into QueryCase.description and EmailMessage.body; a sweep landing
 * between the officer's click and that copy would produce a case with an empty
 * description. Re-checking narrows the window to milliseconds. A truly
 * simultaneous accept remains a named residual risk.
 *
 * The QueryCase veto is also what protects attachment bytes: acceptMessage
 * copies the same attachment ids onto the case, so unlinking them for an
 * accepted message would break its documents.
 */
async function vetoFor(mailboxMessageId) {
  const accepted = await MailboxDecision.findOne({ mailboxMessageId, decision: 'ACCEPTED' }).select('_id').lean();
  if (accepted) return 'accepted';

  const linked = await QueryCase.findOne({ sourceMailboxMessageId: mailboxMessageId }).select('_id').lean();
  if (linked) return 'linkedCase';

  return null;
}

/**
 * Strip one message's content, keeping the stub.
 *
 * Bytes first, then the row. If the process dies between the two, the row still
 * lists the attachment ids so a retry can finish the job, and the unlinks are
 * idempotent. In the other order the ids are gone and the bytes leak forever.
 */
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
      // assertValidId throws on a malformed legacy id, and one bad row must not
      // stop the sweep. The unlinks themselves already tolerate a missing file.
      console.warn(`[qms] retention: could not remove attachment ${id}: ${error.message}`);
    }
  }

  if (!dryRun) {
    await MailboxMessage.updateOne(
      { mailboxMessageId: row.mailboxMessageId, purgedAt: null },
      {
        $set: {
          // Set to the schema default rather than $unset: read paths expect an
          // empty string and an array, not undefined.
          body: '',
          bodyHtml: null,
          attachments: [],
          aiSummary: null,
          purgedAt: nowIso,
          // Preserve a human deletion's own timestamp while still dropping the
          // stub out of the inbox scope, which filters on `removedAt: null`.
          removedAt: row.removedAt ?? nowIso,
        },
      },
    );

    await MailboxTriage.updateOne({ mailboxMessageId: row.mailboxMessageId }, { $set: { purgedAt: nowIso } });
  }

  return { attachmentsRemoved };
}

/**
 * One pass. Never throws — a background job that dies on a bad row stops
 * running altogether, which is the failure nobody notices.
 */
export async function sweepOnce({
  now = Date.now(),
  dryRun = false,
  retentionHours,
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
    // `notEligible` covers both a source that may not be purged and a row an
    // earlier pass already tombstoned — purgeMessageFilter excludes both, and
    // the count is a subtraction, so the two cannot be told apart here.
    skipped: { accepted: 0, linkedCase: 0, notEligible: 0 },
    errors: [],
    durationMs: 0,
    grace: false,
  };

  // Mongoose would otherwise buffer these and reject on a timeout.
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

    const candidates = await findPurgeable({ now, limit, retentionHours });
    result.scanned = candidates.length;
    if (!candidates.length) return { ...result, durationMs: Date.now() - started };

    const byId = new Map(candidates.map((candidate) => [candidate.mailboxMessageId, candidate]));
    const rows = await MailboxMessage.find(purgeMessageFilter([...byId.keys()]))
      // Never `body`, never `bodyHtml`: reading a megabyte in order to delete it
      // defeats the entire purpose.
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
              // Once the body is gone, this is the only answer to "what was
              // thrown away, and who sent it?".
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

    // A summary row only when something happened. A row for every quiet pass
    // would bury the ones that matter.
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
        },
      });
    }
  } catch (error) {
    result.errors.push(error.message);
    console.warn(`[qms] retention sweep failed: ${error.message}`);
  }

  return { ...result, durationMs: Date.now() - started };
}

/** One sweep at a time, whatever the timer does. */
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

/**
 * Start the hourly sweep.
 *
 * Unref'd, so it can never hold the process open, and silent under
 * NODE_ENV=test — the suite has no MongoDB and a background timer there would
 * only make it flaky.
 */
export function startRetentionSweeps(options = {}) {
  if (env.NODE_ENV === 'test') return null;
  if (!env.MAILBOX_RETENTION_ENABLED) return null;
  if (timer) return timer;

  bootedAt = options.bootedAt ?? Date.now();

  timer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  // The first interval tick is an hour away. A deployment restarted more often
  // than that would otherwise never sweep at all, so one early pass is
  // scheduled too — late enough not to compete with boot.
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

/** Test seam: what startRetentionSweeps would use as the boot moment. */
export function setBootedAt(value) {
  bootedAt = value;
}

export default { sweepOnce, startRetentionSweeps, stopRetentionSweeps, PURGEABLE_SOURCES };
