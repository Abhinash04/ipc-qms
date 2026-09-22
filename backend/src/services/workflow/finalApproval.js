import {
  QueryCase,
  QueryCounter,
  ResponseVersion,
  WorkflowStep,
  EmailMessage,
  Notification,
} from '../../models/index.js';
import * as emailService from '../email/emailService.js';
import * as audit from '../audit/auditService.js';
import env from '../../config/env.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_RESULTS } from '../../constants/auditActions.js';

/**
 * The Officer-in-Charge grants final approval, and the response goes out.
 *
 * This used to run in the browser: `grantFinalApproval` recorded the approval
 * and then immediately called `dispatchResponse` with a null actor, on the
 * theory that an automatic dispatch is "the system acting". The null actor only
 * ever skipped the *client's* permission check — the request still carried the
 * Officer-in-Charge's session cookie, and `POST /emails/response` is gated on
 * DISPATCH, which belongs to the Front Office. So every approval ended in a 403
 * and every case stranded at READY_FOR_DISPATCH with nothing sent.
 *
 * Moving it here is what makes the automatic send legitimate rather than a
 * permission the client wished it had: the Officer-in-Charge's session
 * authorises FINAL_APPROVE, which is theirs, and the *server* performs the send
 * under the Front Office identity it already holds. No role gained DISPATCH.
 *
 * Two orderings matter and are deliberate:
 *
 *   - The approval is recorded **before** any mail is attempted. Approval is a
 *     decision a person made; it must survive a mail server being down.
 *   - The case becomes CLOSED **only after** a send that actually happened. A
 *     case reading CLOSED while the inquirer received nothing is the single
 *     worst state this workflow can reach, because nobody goes looking for it.
 *
 * Like the accept sequence, every step checks its own artefact first, so this
 * is safe to retry and a retry completes only what did not finish.
 */

const COUNTER_KEY = 'counters';
const pad = (n) => String(n).padStart(5, '0');

/**
 * Where a case may be when the Officer-in-Charge presses approve.
 *
 * `NEEDS_APPROVAL` still needs the decision recorded. `ALREADY_APPROVED` are
 * the retry states — the approval happened, the send did not, and pressing
 * approve again should finish the job rather than re-decide it or refuse.
 */
// Moved to constants/workflowStates.js, which is now the one place the server
// keeps the workflow vocabulary. These were its only server-side literals.
import { NEEDS_APPROVAL, ALREADY_APPROVED } from '../../constants/workflowStates.js';

const record = (actor, event) => ({
  action: event,
  actorType: ACTOR_TYPES.HUMAN,
  actorId: actor?.id ?? null,
  actorRole: actor?.role ?? null,
});

/** The next id in a client-visible sequence, minted atomically server-side. */
async function mint(prefix) {
  const counter = await QueryCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { [`value.${prefix}`]: 1 } },
    { new: true, upsert: true },
  ).lean();

  return `${prefix}-${pad(counter.value[prefix])}`;
}

/**
 * Did that send actually leave the machine?
 *
 * `getTransport` falls back to the mock when a role holds no usable credential,
 * and the mock returns an ordinary success — which is correct for the mocked
 * tail of a development workflow, and catastrophic here: it would close the
 * case and tell the officer the inquirer had been answered.
 *
 * So a mock result counts as delivery only when mock delivery is what the
 * deployment asked for. Under EMAIL_TRANSPORT=gmail or nic, a mock result means
 * the Front Office credential is missing or revoked, and that is a failure.
 */
function wasReallySent(sent) {
  if (env.EMAIL_TRANSPORT === 'mock') return true;
  return sent?.transport !== 'mock';
}

/**
 * @returns {{queryId, approved, dispatched, alreadyDispatched, workflowState,
 *            recipient, errors}}
 */
export async function grantFinalApproval({ queryId, actor, comment = '' }) {
  const errors = [];

  const query = await QueryCase.findOne({ queryId }).lean();
  if (!query) {
    throw Object.assign(new Error(`Query case ${queryId} does not exist`), { status: 404 });
  }

  const needsApproval = NEEDS_APPROVAL.includes(query.workflowState);

  if (!needsApproval && !ALREADY_APPROVED.includes(query.workflowState)) {
    throw Object.assign(
      new Error(
        `${queryId} is ${query.workflowState} and cannot be finally approved — ` +
          `expected one of ${NEEDS_APPROVAL.join(', ')}`,
      ),
      { status: 409 },
    );
  }

  const approvedVersion = (
    await ResponseVersion.find({ queryId }).sort({ createdAt: 1 }).lean()
  ).at(-1);

  if (!approvedVersion) {
    throw Object.assign(new Error(`${queryId} has no drafted response to approve`), { status: 409 });
  }

  const now = () => new Date().toISOString();

  // 1. Record the approval. Skipped on a retry — the case is already past it,
  //    and a second FINAL_APPROVAL_GRANTED row would claim a decision that was
  //    taken once.
  if (needsApproval) {
    await ResponseVersion.updateOne(
      { responseId: approvedVersion.responseId },
      { $set: { status: 'FINAL_APPROVED', approvedAt: now() } },
    );

    await WorkflowStep.updateMany(
      { queryId, status: { $ne: 'COMPLETED' } },
      { $set: { status: 'COMPLETED', completedAt: now() } },
    );

    await QueryCase.updateOne(
      { queryId },
      { $set: { workflowState: 'READY_FOR_DISPATCH', updatedAt: now() } },
    );

    await audit.record({
      ...record(actor, 'FINAL_APPROVAL_GRANTED'),
      queryId,
      details:
        `Final approval granted; ${approvedVersion.version} locked and ready for dispatch.` +
        (comment ? ` ${comment}` : ''),
    });
  }

  // 2. Already dispatched? The stored outbound response is the guard, so a
  //    double click, a retry or a second officer cannot email the inquirer
  //    twice.
  const alreadySent = await EmailMessage.findOne({
    queryId,
    emailType: 'OUTGOING_RESPONSE',
  }).lean();

  if (alreadySent) {
    return {
      queryId,
      approved: true,
      dispatched: false,
      alreadyDispatched: true,
      workflowState: 'CLOSED',
      recipient: [alreadySent.to].flat()[0] ?? null,
      errors,
    };
  }

  // 3. The response goes to whoever wrote in — the address stored on the case
  //    at intake, read off the original From header. There is no configured
  //    recipient anywhere on this path.
  const recipient = query.inquirer?.email || null;
  if (!recipient) {
    errors.push({ step: 'dispatch', error: 'The case carries no inquirer address.' });
    return {
      queryId,
      approved: true,
      dispatched: false,
      alreadyDispatched: false,
      workflowState: 'READY_FOR_DISPATCH',
      recipient: null,
      errors,
    };
  }

  const subject = `Re: ${query.subject} [${queryId}]`;

  try {
    const sent = await emailService.sendResponse({
      to: recipient,
      subject,
      body: approvedVersion.content || '',
      providerThreadId: query.providerThreadId || null,
      // Answered through the mailbox the enquiry arrived in.
      sourceMailbox: query.sourceMailbox || null,
    });

    if (!wasReallySent(sent)) {
      throw new Error(
        'The Front Office mailbox has no usable credential, so the response was not sent. ' +
          'Refusing to close the case on a send that did not happen.',
      );
    }

    await EmailMessage.create({
      messageId: await mint('MSG'),
      threadId: query.threadId ?? null,
      queryId,
      direction: 'OUTBOUND',
      emailType: 'OUTGOING_RESPONSE',
      timestamp: sent.sentAt || now(),
      from: sent.from,
      to: [sent.to].flat(),
      subject: sent.subject || subject,
      body: sent.body || approvedVersion.content || '',
      providerMessageId: sent.providerMessageId || null,
      providerThreadId: sent.providerThreadId || null,
    });

    await QueryCase.updateOne(
      { queryId },
      { $set: { workflowState: 'DISPATCHED', updatedAt: now() } },
    );

    await audit.record({
      ...record(actor, 'RESPONSE_DISPATCHED'),
      queryId,
      details: `Approved response ${approvedVersion.version} emailed to ${recipient}.`,
    });

    // 4. Closed, and only now. Everything above has to have happened.
    await QueryCase.updateOne(
      { queryId },
      { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED', updatedAt: now() } },
    );

    await audit.record({
      ...record(actor, 'QUERY_CLOSED'),
      queryId,
      details: 'Query closed following dispatch.',
    });

    await Notification.create({
      notificationId: await mint('NOTIF'),
      queryId,
      recipientRole: 'FRONT_OFFICE',
      title: `${queryId} dispatched`,
      message: `${queryId} has been answered and closed.`,
      at: now(),
    });

    return {
      queryId,
      approved: true,
      dispatched: true,
      alreadyDispatched: false,
      workflowState: 'CLOSED',
      recipient,
      errors,
    };
  } catch (error) {
    /**
     * The approval stands; only the send failed. READY_FOR_DISPATCH is exactly
     * that state — approved, response locked, inquirer not yet told — and it is
     * the state the Front Office "Retry sending response" control acts on, so
     * the recovery path is the one that already exists.
     *
     * Recorded against the case, unlike the transport's own EMAIL_SEND_FAILED
     * rows, which carry no queryId and so cannot be traced back to what failed.
     */
    /**
     * Two different failures, and they need opposite advice.
     *
     * An ordinary failure means nothing left, and the Front Office retry is the
     * right next step. An unconfirmed one — Send pressed in the NICeMail
     * browser, no confirmation seen in time — may already be in the inquirer's
     * inbox, and "retry" is then precisely the wrong instruction. The case
     * stays READY_FOR_DISPATCH in both, because CLOSED is reserved for a send
     * that is known to have happened.
     */
    const unconfirmed = Boolean(error.unconfirmed);

    await audit.record({
      ...record(actor, 'EMAIL_SEND_FAILED'),
      queryId,
      result: AUDIT_RESULTS.FAILURE,
      error: error.message,
      details: unconfirmed
        ? `The approved response to ${recipient} may have been sent but was not confirmed. The case stays ready for dispatch until the NICeMail Sent folder has been checked.`
        : `The approved response to ${recipient} could not be sent. The case stays ready for dispatch.`,
    });

    await Notification.create({
      notificationId: await mint('NOTIF'),
      queryId,
      recipientRole: 'FRONT_OFFICE',
      title: unconfirmed ? `${queryId} may have been sent` : `${queryId} could not be sent`,
      message: unconfirmed
        ? `${queryId}: the response may already have gone out. Check the NICeMail Sent folder before retrying.`
        : `${queryId} is approved but the response did not go out. Retry from the case.`,
      type: 'WARNING',
      at: now(),
    }).catch(() => {});

    errors.push({ step: 'dispatch', error: error.message, ...(unconfirmed ? { unconfirmed: true } : {}) });

    return {
      queryId,
      approved: true,
      dispatched: false,
      alreadyDispatched: false,
      workflowState: 'READY_FOR_DISPATCH',
      recipient,
      errors,
    };
  }
}
