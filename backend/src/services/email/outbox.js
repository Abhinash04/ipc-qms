import { randomUUID } from 'node:crypto';
import { OutboundEmail, OUTBOUND_STATUS, EmailMessage } from '../../models/index.js';
import { DELIVERY, classifyDelivery, describeError, describeFailure, isTransientNetworkFailure } from './delivery.js';

/**
 * Send a case's email at most once — the protocol behind `OutboundEmail`.
 *
 * The rule is simple: **only the request that claims the row may send.** The
 * claim is a unique-keyed insert (or an atomic FAILED → SENDING flip), so of any
 * number of overlapping requests — a double click, a retry pressed while the
 * first send is still hanging, two officers, two tabs — exactly one sends and
 * the rest are told what is happening instead of sending again.
 *
 * What a failure means decides what may happen next:
 *
 *   NOT_SENT   — the message provably never reached the provider: the DNS
 *                lookup failed, the connection was refused, the provider
 *                answered 4xx. Sending again is safe; the row becomes FAILED.
 *   UNCERTAIN  — it may have gone out: a timeout or reset after the request was
 *                made, a 5xx, a NICeMail Send pressed but never confirmed. The
 *                row becomes UNCERTAIN and nothing sends again until the
 *                provider's Sent folder has been checked (`reconcile`) or a
 *                person says what happened (`resolveUncertain`).
 *
 * Unknown errors are UNCERTAIN. Delaying one response costs a person a minute;
 * mailing a member of the public twice from an official mailbox cannot be
 * undone. The classification itself lives in ./delivery.js.
 */

export { DELIVERY };

/** What one call to `dispatchOnce` did. */
export const OUTCOMES = {
  /** This call sent it. */
  SENT: 'SENT',
  /** It had already been sent — by an earlier call, or found in the Sent folder. */
  ALREADY_SENT: 'ALREADY_SENT',
  /** Another request is sending it right now. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** This call's send provably did not go out. Safe to retry. */
  FAILED: 'FAILED',
  /** This call's send may have gone out. */
  UNCERTAIN: 'UNCERTAIN',
  /** An earlier send may have gone out and could not be verified; nothing was sent. */
  BLOCKED_UNCERTAIN: 'BLOCKED_UNCERTAIN',
};

const S = OUTBOUND_STATUS;

/**
 * How long a claim stands before it is presumed dead. It must outlast the
 * slowest send a transport can make — Gmail's client times out at 30 s, and a
 * NICeMail browser send may queue behind others first. A request that is still
 * sending when its lease runs out finds the row UNCERTAIN, never re-sent.
 */
const LEASE_MS = 3 * 60 * 1000;

/** One automatic retry, for failures that never left this machine. */
const QUICK_RETRY_DELAY_MS = 2000;

const HISTORY_LIMIT = 20;

const iso = (ms = Date.now()) => new Date(ms).toISOString();

export const dispatchKey = (emailType, queryId) => `${emailType}:${queryId}`;

export const isDuplicateKey = (error) => error?.code === 11000 || /E11000/.test(String(error?.message || ''));

const entry = (event, detail = null) => ({ at: iso(), event, detail });
const pushHistory = (...entries) => ({ history: { $each: entries, $slice: -HISTORY_LIMIT } });

/** A Message-ID for one attempt — what the Sent-folder search looks for. */
function newRfcMessageId(queryId, emailType, domain) {
  const right = String(domain || '').trim().toLowerCase() || 'ipc-qms.invalid';
  return `qms.${emailType.toLowerCase()}.${queryId}.${randomUUID()}@${right}`;
}

/** What callers and the API may see of a row. The claim token stays server-side. */
export function toPublic(doc) {
  if (!doc) return null;
  const { _id, claimToken, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
}

/**
 * A case sent before this ledger existed has an EmailMessage but no row. Adopt
 * it as SENT, so it can never be sent a second time.
 */
async function adoptLegacy({ key, queryId, emailType }) {
  if (await OutboundEmail.findOne({ dispatchKey: key }).lean()) return;

  const artefact = await EmailMessage.findOne({ queryId, emailType }).lean();
  if (!artefact) return;

  try {
    await OutboundEmail.create({
      dispatchKey: key,
      queryId,
      emailType,
      status: S.SENT,
      recipients: [artefact.to].flat().filter(Boolean),
      subject: artefact.subject || '',
      attempts: 1,
      providerMessageId: artefact.providerMessageId || null,
      providerThreadId: artefact.providerThreadId || null,
      sentAt: artefact.timestamp || null,
      history: [entry('ADOPTED', `Recorded as sent from ${artefact.messageId}.`)],
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

/**
 * Take the right to send, or learn who has it.
 *
 * @returns {{ claimed: boolean, doc: object }}
 */
async function claim({ key, queryId, emailType, recipients, subject, transport, domain }) {
  const now = Date.now();
  const token = randomUUID();
  const fields = {
    status: S.SENDING,
    claimToken: token,
    leaseExpiresAt: iso(now + LEASE_MS),
    attemptedAt: iso(now),
    rfcMessageId: newRfcMessageId(queryId, emailType, domain),
    recipients,
    subject,
    transport,
    updatedAt: iso(now),
  };

  try {
    const doc = await OutboundEmail.create({
      dispatchKey: key,
      queryId,
      emailType,
      attempts: 1,
      history: [entry('CLAIMED')],
      createdAt: iso(now),
      ...fields,
    });
    return { claimed: true, doc: doc.toObject ? doc.toObject() : doc };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }

  // Only a send that provably did not go out may be claimed again. The filter
  // on status makes this atomic: of two requests, one flips the row and the
  // other matches nothing.
  const reclaimed = await OutboundEmail.findOneAndUpdate(
    { dispatchKey: key, status: S.FAILED },
    { $set: fields, $inc: { attempts: 1 }, $push: pushHistory(entry('RETRY_CLAIMED')) },
    { returnDocument: 'after' },
  ).lean();
  if (reclaimed) return { claimed: true, doc: reclaimed };

  return { claimed: false, doc: await OutboundEmail.findOne({ dispatchKey: key }).lean() };
}

/** Settle a row this request claimed. The token proves it is still ours. */
async function settle(doc, status, set, historyEntry) {
  return OutboundEmail.findOneAndUpdate(
    { dispatchKey: doc.dispatchKey, claimToken: doc.claimToken, status: { $in: [S.SENDING, S.UNCERTAIN] } },
    { $set: { status, ...set, updatedAt: iso() }, $push: pushHistory(historyEntry) },
    { returnDocument: 'after' },
  ).lean();
}

/** A claim whose lease ran out: the sender died or hung, and the outcome is unknown. */
async function expireLease(doc) {
  const now = iso();
  const expired = await OutboundEmail.findOneAndUpdate(
    { dispatchKey: doc.dispatchKey, status: S.SENDING, leaseExpiresAt: { $lt: now } },
    {
      $set: {
        status: S.UNCERTAIN,
        lastOutcome: DELIVERY.UNCERTAIN,
        lastError: 'The send never reported back before its lease expired; it may or may not have gone out.',
        updatedAt: now,
      },
      $push: pushHistory(entry('LEASE_EXPIRED')),
    },
    { returnDocument: 'after' },
  ).lean();
  return expired || OutboundEmail.findOne({ dispatchKey: doc.dispatchKey }).lean();
}

/** Record SENT for a row that was UNCERTAIN, on evidence other than our own send. */
async function confirmSent(doc, set, historyEntry) {
  return OutboundEmail.findOneAndUpdate(
    { dispatchKey: doc.dispatchKey, status: S.UNCERTAIN },
    { $set: { status: S.SENT, ...set, updatedAt: iso() }, $push: pushHistory(historyEntry) },
    { returnDocument: 'after' },
  ).lean();
}

async function confirmNotSent(doc, historyEntry) {
  return OutboundEmail.findOneAndUpdate(
    { dispatchKey: doc.dispatchKey, status: S.UNCERTAIN },
    {
      $set: { status: S.FAILED, lastOutcome: DELIVERY.NOT_SENT, updatedAt: iso() },
      $push: pushHistory(historyEntry),
    },
    { returnDocument: 'after' },
  ).lean();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bookkeeping after a send — the EmailMessage, audit rows, state moves.
 *
 * Its failure is logged and swallowed. The email has gone; reporting the call
 * as failed would invite a retry that sends it again. `finalize` is idempotent,
 * so the next call for this case completes whatever did not land.
 */
async function runFinalize(finalize, doc, sent) {
  if (!finalize) return;
  try {
    await finalize(doc, sent);
  } catch (error) {
    console.error(`[outbox] ${doc.dispatchKey} was sent, but recording it failed: ${error.message}`);
  }
}

/**
 * Send one case email, at most once.
 *
 * @param {object} options
 * @param {(ctx: {rfcMessageId: string}) => Promise<object>} options.send
 *        Performs the send; throws on failure.
 * @param {(doc: object) => Promise<'SENT'|'NOT_SENT'|'UNKNOWN'|{verdict, providerMessageId?}>} [options.reconcile]
 *        Asks the provider whether an UNCERTAIN send went out.
 * @param {(doc: object, sent: object|null) => Promise<void>} [options.finalize]
 *        Idempotent bookkeeping once the email is known to be sent.
 * @param {(doc: object, error: Error, delivery: string) => Promise<void>} [options.onFailure]
 *        Called once when this call's send failed.
 */
export async function dispatchOnce({
  queryId,
  emailType,
  recipients = [],
  subject = '',
  transport = null,
  domain = null,
  send,
  reconcile = null,
  finalize = null,
  onFailure = null,
  quickRetryDelayMs = QUICK_RETRY_DELAY_MS,
}) {
  const key = dispatchKey(emailType, queryId);
  const meta = { key, queryId, emailType, recipients, subject, transport, domain };

  await adoptLegacy(meta);

  let attempt = await claim(meta);

  if (!attempt.claimed) {
    const answer = await answerFromRow(attempt.doc, { meta, reconcile, finalize });
    if (answer.result) return answer.result;
    attempt = answer.attempt;
  }

  return sendClaimed({ doc: attempt.doc, meta, send, finalize, onFailure, quickRetryDelayMs, allowQuickRetry: true });
}

/**
 * Someone else holds the row, or it is settled. Say what that means for this
 * call — or, when the Sent folder proves an UNCERTAIN send never left, take the
 * claim so this call can send.
 *
 * @returns {{ result?: object, attempt?: { claimed: true, doc: object } }}
 */
async function answerFromRow(found, { meta, reconcile, finalize }) {
  let doc = found;

  if (doc?.status === S.SENDING && doc.leaseExpiresAt && doc.leaseExpiresAt < iso()) {
    doc = await expireLease(doc);
  }

  if (doc?.status === S.SENT) {
    await runFinalize(finalize, doc, null);
    return { result: { outcome: OUTCOMES.ALREADY_SENT, dispatch: toPublic(doc) } };
  }

  if (doc?.status === S.SENDING) {
    return { result: { outcome: OUTCOMES.IN_PROGRESS, dispatch: toPublic(doc) } };
  }

  if (doc?.status === S.UNCERTAIN) {
    const verdict = await askProvider(reconcile, doc);

    if (verdict.verdict === 'SENT') {
      const confirmed =
        (await confirmSent(
          doc,
          {
            sentAt: verdict.sentAt || doc.attemptedAt || iso(),
            providerMessageId: verdict.providerMessageId || doc.providerMessageId || null,
            providerThreadId: verdict.providerThreadId || doc.providerThreadId || null,
          },
          entry('CONFIRMED_IN_SENT_FOLDER'),
        )) || (await OutboundEmail.findOne({ dispatchKey: doc.dispatchKey }).lean());
      await runFinalize(finalize, confirmed, null);
      return { result: { outcome: OUTCOMES.ALREADY_SENT, dispatch: toPublic(confirmed), reconciled: true } };
    }

    if (verdict.verdict !== 'NOT_SENT') {
      return {
        result: {
          outcome: OUTCOMES.BLOCKED_UNCERTAIN,
          dispatch: toPublic(doc),
          error:
            'An earlier attempt may already have sent this email, and it could not be verified' +
            `${doc.lastError ? `: ${doc.lastError}` : ''}. Check the Sent folder, then record whether it was sent.`,
        },
      };
    }

    // The Sent folder proves it never left: it is an ordinary failure now.
    await confirmNotSent(doc, entry('NOT_IN_SENT_FOLDER'));
  }

  // FAILED rows are claimable, so the row changed between our two reads — or it
  // was just proven unsent above. Either way, try once more for the claim.
  const again = await claim(meta);
  if (again.claimed) return { attempt: again };
  return { result: { outcome: OUTCOMES.IN_PROGRESS, dispatch: toPublic(again.doc) } };
}

async function askProvider(reconcile, doc) {
  if (!reconcile) return { verdict: 'UNKNOWN' };
  try {
    const answer = await reconcile(doc);
    return typeof answer === 'string' ? { verdict: answer } : answer || { verdict: 'UNKNOWN' };
  } catch (error) {
    console.warn(`[outbox] could not check whether ${doc.dispatchKey} was sent: ${describeError(error)}`);
    return { verdict: 'UNKNOWN' };
  }
}

async function sendClaimed({ doc, meta, send, finalize, onFailure, quickRetryDelayMs, allowQuickRetry }) {
  let sent;
  try {
    sent = await send({ rfcMessageId: doc.rfcMessageId });
  } catch (error) {
    const delivery = classifyDelivery(error);
    const reason = describeFailure(error);
    // The step a staged sender (the NICeMail agent) stopped at, for the caller.
    const stage = error?.failedStep ? { stage: error.failedStep } : {};

    if (delivery === DELIVERY.NOT_SENT) {
      const failed =
        (await settle(doc, S.FAILED, { lastError: reason, lastOutcome: delivery }, entry('NOT_SENT', reason))) || doc;

      if (allowQuickRetry && isTransientNetworkFailure(error)) {
        await sleep(quickRetryDelayMs);
        const again = await claim(meta);
        if (again.claimed) {
          return sendClaimed({ doc: again.doc, meta, send, finalize, onFailure, quickRetryDelayMs, allowQuickRetry: false });
        }
        // Someone else claimed it in the meantime; their attempt stands.
        return { outcome: OUTCOMES.IN_PROGRESS, dispatch: toPublic(again.doc) };
      }

      if (onFailure) await onFailure(failed, error, delivery);
      return { outcome: OUTCOMES.FAILED, dispatch: toPublic(failed), error: reason, retryable: true, ...stage };
    }

    const uncertain =
      (await settle(doc, S.UNCERTAIN, { lastError: reason, lastOutcome: delivery }, entry('UNCERTAIN', reason))) || doc;
    if (onFailure) await onFailure(uncertain, error, delivery);
    return { outcome: OUTCOMES.UNCERTAIN, dispatch: toPublic(uncertain), error: reason, unconfirmed: true, ...stage };
  }

  let settled = null;
  try {
    settled = await settle(
      doc,
      S.SENT,
      {
        sentAt: sent?.sentAt || iso(),
        providerMessageId: sent?.providerMessageId || null,
        providerThreadId: sent?.providerThreadId || null,
        transport: sent?.transport || meta.transport,
        lastError: null,
        lastOutcome: null,
      },
      entry('SENT'),
    );
  } catch (error) {
    // The email went. If the row cannot be written now, its lease expires, it
    // turns UNCERTAIN, and the Sent-folder check settles it — never a resend.
    console.error(`[outbox] ${doc.dispatchKey} was sent, but the ledger write failed: ${error.message}`);
  }

  const final = settled || { ...doc, status: S.SENT, sentAt: sent?.sentAt || iso() };
  await runFinalize(finalize, final, sent);
  return { outcome: OUTCOMES.SENT, dispatch: toPublic(final), sent };
}

/**
 * A person has checked the Sent folder and says what happened to an UNCERTAIN
 * send. The only way out of UNCERTAIN for a transport that cannot be asked.
 */
export async function resolveUncertain({ queryId, emailType, outcome, actor, finalize = null }) {
  const key = dispatchKey(emailType, queryId);
  const doc = await OutboundEmail.findOne({ dispatchKey: key }).lean();

  if (!doc) {
    throw Object.assign(new Error(`No ${emailType} has been attempted for ${queryId}`), { status: 404 });
  }
  if (doc.status !== S.UNCERTAIN) {
    throw Object.assign(
      new Error(`The ${emailType} for ${queryId} is ${doc.status}, not UNCERTAIN — there is nothing to resolve`),
      { status: 409, details: { dispatch: toPublic(doc) } },
    );
  }

  const resolvedBy = { id: actor?.id ?? null, role: actor?.role ?? null, at: iso(), outcome };

  if (outcome === DELIVERY.NOT_SENT) {
    const failed = await OutboundEmail.findOneAndUpdate(
      { dispatchKey: key, status: S.UNCERTAIN },
      {
        $set: { status: S.FAILED, lastOutcome: DELIVERY.NOT_SENT, resolvedBy, updatedAt: iso() },
        $push: pushHistory(entry('RESOLVED_NOT_SENT', actor?.role || null)),
      },
      { returnDocument: 'after' },
    ).lean();
    return { dispatch: toPublic(failed || doc) };
  }

  const sent = await confirmSent(doc, { sentAt: iso(), resolvedBy }, entry('RESOLVED_SENT', actor?.role || null));
  const final = sent || (await OutboundEmail.findOne({ dispatchKey: key }).lean());
  await runFinalize(finalize, final, null);
  return { dispatch: toPublic(final) };
}

/** Every row for a case, for the case page. */
export async function forCase(queryId) {
  return (await OutboundEmail.find({ queryId }).lean()).map(toPublic);
}
