import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  EmailThread,
} from '../../../models/index.js';
import * as caseMail from '../caseMail.js';
import { isDuplicateKey, OUTCOMES } from '../outbox.js';
import * as audit from '../../audit/auditService.js';
import * as gemmaService from '../../ai/gemmaService.js';
import * as decisions from './decisions.js';
import { ACTOR_TYPES } from '../../../constants/roles.js';
// `result` is enum-validated on the model, so a typo there fails the write
// silently rather than at the call site.
import { AUDIT_RESULTS } from '../../../constants/auditActions.js';

/**
 * Accepting an incoming message as an IPC query, server-side and in one call.
 *
 * The browser used to orchestrate this: mint the id, create the case, send the
 * acknowledgement, send the forward, persisting each step separately. A closed
 * tab or a dropped connection halfway through left a case nobody had been told
 * about, and the Case ID came from a counter the client held, so two tabs could
 * mint the same one.
 *
 * Here the whole sequence is one request. MongoDB has no cross-document
 * transactions on a standalone server, so this is not atomic — instead every
 * step is guarded on its own, which makes the whole operation safe to retry
 * and safe to run twice at once. The case by a unique index on the message id;
 * the acknowledgement and the forward by the outbox's claim (caseMail.js), so
 * of two overlapping requests exactly one sends each. Pressing ✓ again after
 * a failure re-attempts only what did not complete; it cannot produce a second
 * case, a second acknowledgement or a second forward.
 *
 * What is deliberately NOT done here: failing the request because a step
 * failed. A case that exists but was not forwarded is a real state an operator
 * can recover from, and hiding it behind a 500 would lose the case as well.
 * Each outcome is reported, and the caller decides what to say.
 */

const COUNTER_KEY = 'counters';
const pad = (n) => String(n).padStart(5, '0');

/** `Name <addr>` or a bare address → the address. */
function bareAddress(header) {
  const raw = String(header || '');
  return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
}

/** `Name <addr>` → `Name`, falling back to the address. */
function displayName(header) {
  const raw = String(header || '').trim();
  const name = raw.includes('<') ? raw.split('<')[0].trim().replace(/^"|"$/g, '') : '';
  return name || bareAddress(raw);
}

/**
 * Mint the next Case ID atomically.
 *
 * `$inc` under a unique key is the whole guarantee: MongoDB serialises the
 * update, so two concurrent accepts receive different numbers. The year is a
 * label on the id, not part of the sequence — matching the format the client
 * has always produced.
 */
async function mintIds(timestamp) {
  const counter = await QueryCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { 'value.QRY': 1, 'value.THREAD': 1, 'value.MSG': 1 } },
    { returnDocument: 'after', upsert: true },
  ).lean();

  const year = new Date(timestamp || Date.now()).getUTCFullYear();
  const { QRY, THREAD, MSG } = counter.value;

  return {
    queryId: `QRY-${year}-${pad(QRY)}`,
    threadId: `THREAD-${year}-${pad(THREAD)}`,
    messageId: `MSG-${pad(MSG)}`,
  };
}

const record = (actor, event) => ({
  action: event,
  actorType: ACTOR_TYPES.HUMAN,
  actorId: actor?.id ?? null,
  actorRole: actor?.role ?? null,
});

/** A summary we already have and can use — anything else is worth retrying. */
const isUsable = (summary) =>
  summary?.status === 'GENERATED' || summary?.status === 'FALLBACK';

/** Outcomes after which the email is known to be out. */
const SENT = new Set([OUTCOMES.SENT, OUTCOMES.ALREADY_SENT]);

/**
 * How a send that did not complete is reported to the page.
 *
 * `unconfirmed` means the email may already be in the recipient's inbox — the
 * flag that stops the page offering a blind retry. `retryable` means it
 * provably never left. `inProgress` means another request holds the send.
 */
function stepError(step, result, noRecipientMessage = null) {
  if (result.outcome === 'NO_RECIPIENT') {
    return { step, outcome: result.outcome, error: noRecipientMessage || result.error };
  }

  const uncertain = result.outcome === OUTCOMES.UNCERTAIN || result.outcome === OUTCOMES.BLOCKED_UNCERTAIN;
  const inProgress = result.outcome === OUTCOMES.IN_PROGRESS;

  return {
    step,
    outcome: result.outcome,
    error: inProgress ? `The ${step} is being sent by another request.` : result.error,
    // The step a staged sender (the NICeMail agent) stopped at.
    ...(result.stage ? { stage: result.stage } : {}),
    ...(uncertain ? { unconfirmed: true } : {}),
    ...(inProgress ? { inProgress: true } : {}),
    ...(result.outcome === OUTCOMES.FAILED ? { retryable: true } : {}),
  };
}

/**
 * Summarise the enquiry, and say honestly what kind of summary it is.
 *
 * `generateSummary` does not throw — an unreachable model, a timeout or a
 * non-2xx all return a deterministic fallback with `fallback: true`. That is
 * useful, but it must not be presented as the model's work, so the status
 * distinguishes the three outcomes and rides inside the stored object:
 *
 *   GENERATED — the model answered
 *   FALLBACK  — the model did not, and this is the deterministic stand-in
 *   FAILED    — the call itself blew up; nothing usable, and worth retrying
 *
 * Never throws, for the same reason the acknowledgement and the forward do not:
 * a case that exists without a summary is recoverable, and losing the case to
 * protect the summary would not be.
 */
async function summarise({ subject, body, inquirerName }) {
  const startedAt = Date.now();

  try {
    const summary = await gemmaService.generateSummary({ subject, body, inquirerName });

    return {
      summary: {
        ...summary,
        status: summary?.fallback ? 'FALLBACK' : 'GENERATED',
        generatedAt: new Date().toISOString(),
        error: null,
      },
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      summary: {
        text: '',
        keyPoints: [],
        topics: [],
        aiGenerated: false,
        fallback: false,
        status: 'FAILED',
        generatedAt: new Date().toISOString(),
        error: error.message,
      },
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

/**
 * @returns {{queryId, created, acknowledged, forwarded, alreadyDecided, errors}}
 */
export async function acceptMessage({ mailboxMessageId, message = {}, actor, sourceMailbox = null }) {
  const errors = [];

  // 1. Has this message already produced a case? Two independent records can
  //    say so — the durable decision, and the stored inbound message — and
  //    either is enough to reuse the case rather than mint a second one.
  //
  //    Resolved rather than returned on: a case that exists is not a case that
  //    was acknowledged and forwarded. Answering here would make a retry after
  //    a failed send a no-op, which is the opposite of what pressing ✓ again is
  //    for. The steps below decide for themselves what is left to do.
  const existingDecision = await decisions.findDecision(mailboxMessageId);
  const decidedQueryId =
    existingDecision?.decision === 'ACCEPTED' ? existingDecision.queryId : null;

  const already = await EmailMessage.findOne({ sourceMessageId: mailboxMessageId }).lean();

  const knownQueryId = decidedQueryId || already?.queryId || null;
  // Decided, but the case is gone — a reset, or a write that never landed. The
  // case is rebuilt below rather than leaving the message unusable.
  let known = knownQueryId
    ? await QueryCase.findOne({ queryId: knownQueryId }).lean()
    : null;

  const receivedAt = message.receivedAt || new Date().toISOString();
  const now = new Date().toISOString();
  const senderEmail = bareAddress(message.from);

  let queryId = known?.queryId;
  let minted = null;

  // 2. The case. A real insert, not an upsert — so a duplicate id is rejected
  //    by the unique index rather than silently overwriting a live case.
  if (!known) {
    minted = await mintIds(receivedAt);

    try {
      await QueryCase.create({
        queryId: minted.queryId,
        subject: message.subject || '(no subject)',
        description: message.body || '',
        source: 'Email',
        // The inquirer is whoever wrote in. No lookup, no configured address.
        inquirer: { id: null, name: displayName(message.from), email: senderEmail },
        workflowState: 'RECEIVED',
        businessStatus: 'OPEN',
        priority: 'NORMAL',
        attachments: message.attachments || [],
        threadId: minted.threadId,
        sourceEmailId: minted.messageId,
        sourceMailboxMessageId: mailboxMessageId,
        sourceMailbox,
        createdAt: now,
        updatedAt: now,
      });
      queryId = minted.queryId;
    } catch (error) {
      /**
       * Another accept of this same message created the case first — the
       * unique index on sourceMailboxMessageId admits one. Carry on with that
       * case: its registration is the winner's to record, and the sends below
       * are guarded on their own, so nothing happens twice. The minted id is
       * simply never used.
       */
      if (!isDuplicateKey(error)) throw error;
      known = await QueryCase.findOne({ sourceMailboxMessageId: mailboxMessageId }).lean();
      if (!known) throw error;
      queryId = known.queryId;
    }
  }

  // Registration is recorded once, by the request whose insert created the case.
  const created = !known;

  if (created) {
    const { threadId } = minted;

    await EmailThread.updateOne(
      { threadId },
      { $setOnInsert: { threadId, queryId, createdAt: now } },
      { upsert: true },
    );

    await EmailMessage.updateOne(
      { sourceMessageId: mailboxMessageId },
      {
        $setOnInsert: {
          messageId: minted.messageId,
          threadId,
          queryId,
          direction: 'INBOUND',
          emailType: 'INCOMING_QUERY',
          timestamp: receivedAt,
          from: message.from || senderEmail,
          to: message.to ? [message.to].flat() : [],
          cc: message.cc || [],
          bcc: message.bcc || [],
          subject: message.subject || '(no subject)',
          body: message.body || '',
          attachments: message.attachments || [],
          sourceMessageId: mailboxMessageId,
          providerMessageId: message.providerMessageId || mailboxMessageId,
          providerThreadId: message.providerThreadId || null,
        },
      },
      { upsert: true },
    );

    await audit.record({ ...record(actor, 'QUERY_RECEIVED'), queryId, details: `Enquiry received from ${senderEmail}.` });
    await audit.record({ ...record(actor, 'QUERY_REGISTERED'), queryId, details: 'Front Office accepted the message and registered the query.' });
    // The one row that ties the mailbox message to the case it became.
    await audit.record({
      ...record(actor, 'CASE_ASSOCIATED'),
      queryId,
      messageId: mailboxMessageId,
      threadId: message.providerThreadId || null,
      details: { source: sourceMailbox?.source ?? null },
    });

    await QueryCase.updateOne(
      { queryId },
      { $set: { workflowState: 'FRONT_OFFICE_VERIFICATION', updatedAt: new Date().toISOString() } },
    );
  }

  /**
   * 3. Summarise the enquiry, and store it on the case.
   *
   * Generated here rather than left to the forward. `forwardToOfficerInCharge`
   * has always produced a summary for its covering note and returned it, and
   * every caller dropped it on the floor — so a summary was computed, mailed to
   * the Officer-in-Charge, audited, and never written to the case that paid for
   * it. Passing it in through the `aiSummary` parameter the forward already
   * accepts keeps that to one model call, not two.
   *
   * Persisted before the acknowledgement and independently of the forward, so a
   * case whose forward fails is still a summarised case. That is also why the
   * audit row sits here rather than inside the send.
   */
  let aiSummary = known?.aiSummary ?? null;

  if (!isUsable(aiSummary)) {
    const attempt = await summarise({
      subject: message.subject || '',
      body: message.body || '',
      inquirerName: displayName(message.from),
    });

    aiSummary = attempt.summary;

    await QueryCase.updateOne(
      { queryId },
      { $set: { aiSummary, updatedAt: new Date().toISOString() } },
    );

    await audit.record({
      ...record(actor, 'AI_SUMMARY_GENERATED'),
      actorType: ACTOR_TYPES.AGENT,
      queryId,
      result: attempt.error ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
      error: attempt.error,
      aiMetadata: {
        latencyMs: attempt.latencyMs,
        fallback: Boolean(aiSummary.fallback),
        aiGenerated: Boolean(aiSummary.aiGenerated),
        status: aiSummary.status,
        trigger: 'accept',
      },
      details: `AI summary ${aiSummary.status.toLowerCase()} for the accepted enquiry.`,
    });

    if (attempt.error) errors.push({ step: 'aiSummary', error: attempt.error });
  }

  // 4. Acknowledge the person who actually wrote in, and 5. forward to the
  //    Officer-in-Charge. Each is sent at most once, whatever retries or
  //    concurrent accepts do (caseMail.js); a failure costs that step, never
  //    the case. A forward that did not go out leaves the case at
  //    FRONT_OFFICE_VERIFICATION, which is the state the manual "Forward to
  //    Officer-in-Charge" button acts on.
  const ack = await caseMail.acknowledge({ queryId, actor });
  const acknowledged = SENT.has(ack.outcome);
  if (!acknowledged) {
    errors.push(
      stepError('acknowledgement', ack, 'The incoming message carried no sender address.'),
    );
  }

  const fwd = await caseMail.forward({ queryId, actor, source: created ? message : null });
  const forwarded = SENT.has(fwd.outcome);
  if (!forwarded) errors.push(stepError('forward', fwd));

  return {
    queryId,
    created,
    alreadyDecided: Boolean(known && decidedQueryId),
    acknowledged,
    // What became of the acknowledgement. On a repeat Accept this is the send
    // that already happened (ALREADY_SENT, with its provider id) — nothing is
    // sent twice, and the answer is the same.
    acknowledgement: {
      outcome: ack.outcome,
      providerMessageId: ack.sent?.providerMessageId || ack.dispatch?.providerMessageId || null,
      sentAt: ack.sent?.sentAt || ack.dispatch?.sentAt || null,
    },
    forwarded,
    // Reported as a status rather than a boolean: "we fell back to the
    // deterministic summary because the model timed out" and "the model
    // answered" are different facts, and the UI should not present them alike.
    aiSummaryStatus: aiSummary?.status ?? null,
    errors,
  };
}
