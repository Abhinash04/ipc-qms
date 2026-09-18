import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  EmailThread,
} from '../../../models/index.js';
import * as emailService from '../emailService.js';
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
 * transactions on a standalone server, so this is not atomic — instead **every
 * step checks its own artefact before acting**, which makes the whole operation
 * safe to retry. Pressing ✓ again after a failure re-attempts only what did not
 * complete; it cannot produce a second case, a second acknowledgement or a
 * second forward.
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
    { new: true, upsert: true },
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
  const known = knownQueryId
    ? await QueryCase.findOne({ queryId: knownQueryId }).lean()
    : null;

  const receivedAt = message.receivedAt || new Date().toISOString();
  const now = new Date().toISOString();
  const senderEmail = bareAddress(message.from);

  let queryId = known?.queryId;
  let threadId = known?.threadId;
  // A case keeps the mailbox it was registered from, even across a retry.
  const caseMailbox = known ? known.sourceMailbox ?? null : sourceMailbox;

  // 2. The case. A real insert, not an upsert — so a duplicate id is rejected
  //    by the unique index rather than silently overwriting a live case.
  if (!known) {
    const minted = await mintIds(receivedAt);
    queryId = minted.queryId;
    threadId = minted.threadId;

    await QueryCase.create({
      queryId,
      subject: message.subject || '(no subject)',
      description: message.body || '',
      source: 'Email',
      // The inquirer is whoever wrote in. No lookup, no configured address.
      inquirer: { id: null, name: displayName(message.from), email: senderEmail },
      workflowState: 'RECEIVED',
      businessStatus: 'OPEN',
      priority: 'NORMAL',
      attachments: message.attachments || [],
      threadId,
      sourceEmailId: minted.messageId,
      sourceMailboxMessageId: mailboxMessageId,
      sourceMailbox: caseMailbox,
      createdAt: now,
      updatedAt: now,
    });

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

  // 4. Acknowledge the person who actually wrote in. Guarded on the stored
  //    message, so a retry cannot email them twice.
  let acknowledged = false;
  const ackExists = await EmailMessage.findOne({ queryId, emailType: 'ACKNOWLEDGEMENT' }).lean();
  if (ackExists) {
    acknowledged = true;
  } else if (!senderEmail) {
    errors.push({ step: 'acknowledgement', error: 'The incoming message carried no sender address.' });
  } else {
    try {
      const sent = await emailService.sendAcknowledgement({
        to: senderEmail,
        queryId,
        sourceMailbox: caseMailbox,
      });
      await EmailMessage.create({
        messageId: `MSG-ACK-${queryId}`,
        threadId,
        queryId,
        direction: 'OUTBOUND',
        emailType: 'ACKNOWLEDGEMENT',
        timestamp: sent.sentAt || new Date().toISOString(),
        from: sent.from,
        to: [sent.to].flat(),
        subject: sent.subject,
        body: sent.body,
        providerMessageId: sent.providerMessageId || null,
        providerThreadId: sent.providerThreadId || null,
      });
      await audit.record({ ...record(actor, 'ACKNOWLEDGEMENT_SENT'), queryId, details: `Acknowledgement sent to ${senderEmail}.` });
      acknowledged = true;
    } catch (error) {
      // `unconfirmed` means Send was pressed and the transport could not tell
      // whether the message left — only the NICeMail browser can say that. The
      // acknowledgement is not recorded either way, so the flag is what stops
      // the page inviting a blind retry that would email the inquirer twice.
      const unconfirmed = Boolean(error.unconfirmed);

      // Audited like a failed dispatch in final approval. The toast is gone
      // once the Front Officer moves on; this row stays in the case's history,
      // and for an unconfirmed send it is the only lasting record that the
      // inquirer may already have the acknowledgement.
      await audit.record({
        ...record(actor, 'EMAIL_SEND_FAILED'),
        queryId,
        result: AUDIT_RESULTS.FAILURE,
        error: error.message,
        details: unconfirmed
          ? `The acknowledgement to ${senderEmail} may have been sent but was not confirmed. Check the NICeMail Sent folder before retrying.`
          : `The acknowledgement to ${senderEmail} could not be sent.`,
      });

      errors.push({
        step: 'acknowledgement',
        error: error.message,
        ...(unconfirmed ? { unconfirmed: true } : {}),
      });
    }
  }

  // 5. Forward to the Officer-in-Charge. Same shape of guard — this is the step
  //    that had none, and sent the same case to the OIC three times.
  let forwarded = false;
  const fwdExists = await EmailMessage.findOne({ queryId, emailType: 'FORWARD' }).lean();
  if (fwdExists) {
    forwarded = true;
  } else {
    try {
      const sent = await emailService.forwardToOfficerInCharge({
        queryId,
        subject: message.subject || '(no subject)',
        body: message.body || '',
        providerThreadId: message.providerThreadId || null,
        attachments: message.attachments || [],
        // The summary already stored on the case. Passing it stops the forward
        // generating a second one — the covering note and the case now carry
        // the same text, which they did not before.
        aiSummary: isUsable(aiSummary) ? aiSummary : null,
      });
      await EmailMessage.create({
        messageId: `MSG-FWD-${queryId}`,
        threadId,
        queryId,
        direction: 'OUTBOUND',
        emailType: 'FORWARD',
        timestamp: sent.sentAt || new Date().toISOString(),
        from: sent.from,
        to: [sent.to].flat(),
        subject: sent.subject,
        body: sent.body,
        providerMessageId: sent.providerMessageId || null,
        providerThreadId: sent.providerThreadId || null,
      });
      await QueryCase.updateOne(
        { queryId },
        { $set: { workflowState: 'PENDING_ASSIGNMENT', updatedAt: new Date().toISOString() } },
      );
      await audit.record({ ...record(actor, 'QUERY_FORWARDED'), queryId, details: `Forwarded to the Officer-in-Charge for assignment.` });
      forwarded = true;
    } catch (error) {
      // The case stays at FRONT_OFFICE_VERIFICATION, which is exactly the state
      // the manual "Forward to Officer-in-Charge" button acts on. Nothing is
      // lost; the recovery path is the one that already exists.
      errors.push({ step: 'forward', error: error.message });
    }
  }

  return {
    queryId,
    created: !known,
    alreadyDecided: Boolean(known && decidedQueryId),
    acknowledged,
    forwarded,
    // Reported as a status rather than a boolean: "we fell back to the
    // deterministic summary because the model timed out" and "the model
    // answered" are different facts, and the UI should not present them alike.
    aiSummaryStatus: aiSummary?.status ?? null,
    errors,
  };
}
