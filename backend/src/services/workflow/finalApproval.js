import { QueryCase, ResponseVersion, WorkflowStep } from '../../models/index.js';
import * as caseMail from '../email/caseMail.js';
import { OUTCOMES } from '../email/outbox.js';
import * as audit from '../audit/auditService.js';
import { ACTOR_TYPES } from '../../constants/roles.js';

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
 * And both halves happen once, however many times approve is pressed. In a live
 * test the Officer-in-Charge pressed it four times while the first send hung on
 * DNS; each request checked "already sent?", found nothing yet, and sent — the
 * inquirer received the response three times. Now the approval is an atomic
 * state move (only the request that makes it records it) and the send goes
 * through the outbox's claim (email/caseMail.js), so a retry completes only
 * what did not finish and an overlapping request is told the send is under way.
 */

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

/**
 * @returns {{queryId, approved, dispatched, alreadyDispatched, inProgress,
 *            uncertain, outcome, workflowState, recipient, errors}}
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

  // The response goes to whoever wrote in — the address stored on the case at
  // intake, read off the original From header. caseMail reads it the same way.
  const recipient = query.inquirer?.email || null;

  /**
   * 1. Record the approval — once.
   *
   * The state move is the lock. Of any number of requests that found the case
   * awaiting approval, only the one whose update matched records the decision;
   * the others find it already being made and say so, rather than approving
   * twice or racing the send. A retry arrives with the case already past this
   * point and goes straight to the send.
   */
  if (needsApproval) {
    const moved = await QueryCase.findOneAndUpdate(
      { queryId, workflowState: { $in: NEEDS_APPROVAL } },
      { $set: { workflowState: 'READY_FOR_DISPATCH', updatedAt: now() } },
      { returnDocument: 'after' },
    ).lean();

    if (!moved) {
      return {
        queryId,
        approved: true,
        dispatched: false,
        alreadyDispatched: false,
        inProgress: true,
        uncertain: false,
        outcome: OUTCOMES.IN_PROGRESS,
        workflowState: 'READY_FOR_DISPATCH',
        recipient,
        errors,
      };
    }

    await ResponseVersion.updateOne(
      { responseId: approvedVersion.responseId },
      { $set: { status: 'FINAL_APPROVED', approvedAt: now() } },
    );

    await WorkflowStep.updateMany(
      { queryId, status: { $ne: 'COMPLETED' } },
      { $set: { status: 'COMPLETED', completedAt: now() } },
    );

    await audit.record({
      ...record(actor, 'FINAL_APPROVAL_GRANTED'),
      queryId,
      details:
        `Final approval granted; ${approvedVersion.version} locked and ready for dispatch.` +
        (comment ? ` ${comment}` : ''),
    });
  }

  /**
   * 2. The response, sent at most once.
   *
   * The approval stands whatever happens here. A send that fails leaves the
   * case at READY_FOR_DISPATCH — approved, response locked, inquirer not yet
   * told — which is the state the Front Office "Retry sending response"
   * control acts on. CLOSED is reserved for a send known to have happened:
   * caseMail closes the case only once the outbox has recorded it as sent.
   */
  const result = await caseMail.dispatchResponse({ queryId, actor });
  const { outcome } = result;

  const dispatched = outcome === OUTCOMES.SENT;
  const alreadyDispatched = outcome === OUTCOMES.ALREADY_SENT;
  const inProgress = outcome === OUTCOMES.IN_PROGRESS;
  const uncertain = outcome === OUTCOMES.UNCERTAIN || outcome === OUTCOMES.BLOCKED_UNCERTAIN;

  if (!dispatched && !alreadyDispatched && !inProgress) {
    errors.push({
      step: 'dispatch',
      outcome,
      error: result.error || 'The response could not be sent.',
      ...(uncertain ? { unconfirmed: true } : {}),
      ...(outcome === OUTCOMES.FAILED ? { retryable: true } : {}),
    });
  }

  return {
    queryId,
    approved: true,
    dispatched,
    alreadyDispatched,
    inProgress,
    uncertain,
    outcome,
    workflowState: dispatched || alreadyDispatched ? 'CLOSED' : 'READY_FOR_DISPATCH',
    recipient,
    errors,
  };
}
