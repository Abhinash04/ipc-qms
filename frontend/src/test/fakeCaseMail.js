/**
 * An in-process stand-in for the three case-email endpoints —
 * `POST /emails/acknowledgement`, `/emails/forward`, `/emails/response` — and
 * for `POST /queries/:id/outbound/resolve`.
 *
 * These endpoints stopped being "send what I give you" and became "send this
 * case's email, at most once". The rules live in `backend/src/services/email/
 * outbox.js` and are pinned by `backend/src/test/outbox.test.js`; what a
 * frontend test still owns is the client half — that a button asks for the
 * right case, and that the page reports exactly what the server answered,
 * including the two answers that must never be read as "try again": *this is
 * already being sent*, and *this may already have arrived*.
 *
 * So this mirrors the server's effects closely enough for that: it records the
 * email against the case, closes the case after a response that went out, and
 * writes the ledger row the retry controls read. It writes through
 * `fakeQueryApi` because every store action re-reads `GET /queries` afterwards,
 * which discards anything put straight into the store.
 */

import { vi } from 'vitest';
import {
  fetchAllQueries,
  persistQueryTransition,
  recordOutbound,
  __setOutboundResolver,
} from '@/test/fakeQueryApi';
import { createEmailMessage, EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { AUDIT_EVENT, BUSINESS_STATUS, WORKFLOW_STATE } from '@/constants/statusEnums';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';

const userWithRole = (role) => MOCK_USERS.find((user) => user.role === role);
const frontOffice = () => userWithRole(ROLES.FRONT_OFFICE)?.email;

/** The status each outcome arrives as, mirroring emailController.js. */
const STATUS = {
  SENT: 201,
  ALREADY_SENT: 200,
  IN_PROGRESS: 409,
  BLOCKED_UNCERTAIN: 409,
  FAILED: 503,
  UNCERTAIN: 504,
};

/** An axios-shaped rejection, so the client reads the server's reason from it. */
function httpError({ outcome, error }) {
  const status = STATUS[outcome] ?? 500;
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: {
      status,
      data: {
        outcome,
        error,
        ...(outcome === 'UNCERTAIN' || outcome === 'BLOCKED_UNCERTAIN' ? { unconfirmed: true } : {}),
        ...(outcome === 'FAILED' ? { retryable: true } : {}),
      },
    },
  });
}

/** A refusal that never reached a transport, so it carries no outcome. */
function refusal(status, error) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error } },
  });
}

/** The states a response may be sent in — caseMail.js:35. */
const PAST_APPROVAL = [WORKFLOW_STATE.READY_FOR_DISPATCH, WORKFLOW_STATE.DISPATCHED, WORKFLOW_STATE.CLOSED];

const DEFAULT_REASONS = {
  FAILED: 'The mail server could not be reached.',
  UNCERTAIN:
    'The mailbox may have sent this message but did not confirm it in time. Check the Sent folder before retrying.',
  BLOCKED_UNCERTAIN:
    'An earlier attempt may already have sent this email, and it could not be verified. Check the Sent folder, then record whether it was sent.',
  IN_PROGRESS: 'This email is being sent by another request. Refresh in a moment.',
};

/**
 * Build the four endpoints.
 *
 * Each email type takes `{ outcome, error }`: `SENT` (the default) records it
 * and, for a response, closes the case; anything else is answered the way the
 * server answers it, and nothing is recorded. `ledgerOnly` is for the outcomes
 * that leave a row the retry controls must read — UNCERTAIN above all.
 */
/**
 * Point a `vi.mock`ed `@/services/api/mailboxService` at these endpoints.
 *
 * A bare automock resolves to `undefined`, which used to be harmless because
 * the client recorded the email itself. It no longer does: the record, the
 * audit row and the case's move to PENDING_ASSIGNMENT or CLOSED all come back
 * from the server, so a test that wants those effects needs a server.
 */
export function installFakeCaseMail(mailboxService, options) {
  const caseMail = fakeCaseMail(options);
  vi.mocked(mailboxService.sendAcknowledgement).mockImplementation(caseMail.sendAcknowledgement);
  vi.mocked(mailboxService.forwardQuery).mockImplementation(caseMail.forwardQuery);
  vi.mocked(mailboxService.sendResponse).mockImplementation(caseMail.sendResponse);
  // The resolve control reaches its endpoint through queryCaseService, which
  // the global setup replaces with fakeQueryApi — so it is registered there
  // rather than injected by each caller.
  __setOutboundResolver(caseMail.resolveOutboundEmail);
  return caseMail;
}

export function fakeCaseMail({ acknowledgement = {}, forward = {}, response = {} } = {}) {
  const plans = {
    [EMAIL_TYPE.ACKNOWLEDGEMENT]: acknowledgement,
    [EMAIL_TYPE.FORWARD]: forward,
    [EMAIL_TYPE.OUTGOING_RESPONSE]: response,
  };

  const calls = { ACKNOWLEDGEMENT: 0, FORWARD: 0, OUTGOING_RESPONSE: 0 };

  async function caseOf(queryId) {
    // A real round trip. `persistDelta` is fire-and-forget, so the writes from
    // the transitions that led here may still be in flight as microtasks; a
    // macrotask boundary lets them land first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = await fetchAllQueries();
    const query = snapshot.queries.find((q) => q.queryId === queryId);
    if (!query) throw httpError({ outcome: 'FAILED', error: `Query case ${queryId} does not exist` });
    return { snapshot, query };
  }

  async function send(emailType, queryId) {
    if (!queryId) throw httpError({ outcome: 'FAILED', error: '"queryId" is required' });

    calls[emailType] += 1;
    const { snapshot, query } = await caseOf(queryId);

    // The response is refused outright before approval — checked on the stored
    // case, not on what the caller believes. caseMail.js:269-279.
    if (emailType === EMAIL_TYPE.OUTGOING_RESPONSE && !PAST_APPROVAL.includes(query.workflowState)) {
      throw refusal(
        409,
        `${queryId} is ${query.workflowState}; a response is sent only after final approval`,
      );
    }

    const plan = plans[emailType] || {};
    const outcome = plan.outcome || 'SENT';
    const at = new Date().toISOString();

    const recipient =
      emailType === EMAIL_TYPE.FORWARD
        ? userWithRole(ROLES.OFFICER_IN_CHARGE)?.email
        : query.inquirer?.email;

    if (outcome !== 'SENT' && outcome !== 'ALREADY_SENT') {
      recordOutbound({
        queryId,
        emailType,
        status: outcome === 'FAILED' ? 'FAILED' : 'UNCERTAIN',
        recipients: [recipient].filter(Boolean),
        attempts: calls[emailType],
        lastError: plan.error || DEFAULT_REASONS[outcome],
        updatedAt: at,
      });
      throw httpError({ outcome, error: plan.error || DEFAULT_REASONS[outcome] });
    }

    const already = snapshot.emailMessages.some((m) => m.queryId === queryId && m.emailType === emailType);
    if (already) {
      return { queryId, emailType, outcome: 'ALREADY_SENT', transport: 'mock' };
    }

    const subject =
      emailType === EMAIL_TYPE.ACKNOWLEDGEMENT
        ? `Acknowledgement of Query Received – Indian Pharmacopoeia Commission [${queryId}]`
        : emailType === EMAIL_TYPE.FORWARD
          ? `Fwd: ${query.subject} [${queryId}]`
          : `Re: ${query.subject} [${queryId}]`;

    const body =
      emailType === EMAIL_TYPE.OUTGOING_RESPONSE
        ? snapshot.responseVersions.filter((v) => v.queryId === queryId).at(-1)?.content || ''
        : query.description || '';

    await persistQueryTransition({
      addMessages: [
        createEmailMessage({
          messageId: `MSG-${emailType === EMAIL_TYPE.ACKNOWLEDGEMENT ? 'ACK' : emailType === EMAIL_TYPE.FORWARD ? 'FWD' : 'RESP'}-${queryId}`,
          threadId: query.threadId ?? null,
          queryId,
          direction: EMAIL_DIRECTION.OUTBOUND,
          emailType,
          from: frontOffice(),
          to: [recipient].filter(Boolean),
          subject,
          body,
          // The forward carries the enquiry's files; the other two carry none.
          attachments: emailType === EMAIL_TYPE.FORWARD ? query.attachments || [] : [],
          timestamp: at,
          providerMessageId: `fake-${emailType.toLowerCase()}-${queryId}`,
        }),
      ],
      auditEvent: {
        auditId: `AUD-${queryId}-${emailType}`,
        queryId,
        event:
          emailType === EMAIL_TYPE.ACKNOWLEDGEMENT
            ? AUDIT_EVENT.ACKNOWLEDGEMENT_SENT
            : emailType === EMAIL_TYPE.FORWARD
              ? AUDIT_EVENT.QUERY_FORWARDED
              : AUDIT_EVENT.RESPONSE_DISPATCHED,
        actor: userWithRole(ROLES.FRONT_OFFICE)?.name || 'Front Office',
        at,
        details:
          emailType === EMAIL_TYPE.ACKNOWLEDGEMENT
            ? `Acknowledgement sent to ${recipient}.`
            : emailType === EMAIL_TYPE.FORWARD
              ? 'Forwarded to the Officer-in-Charge for assignment.'
              : `Approved response emailed to ${recipient}.`,
      },
    });

    recordOutbound({
      queryId,
      emailType,
      status: 'SENT',
      recipients: [recipient].filter(Boolean),
      attempts: calls[emailType],
      sentAt: at,
      updatedAt: at,
    });

    // The forward moves the case on; the response closes it. Both only after a
    // send that actually happened.
    if (emailType === EMAIL_TYPE.FORWARD && query.workflowState === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION) {
      await persistQueryTransition({
        query: { ...query, workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT, updatedAt: at },
        notification: {
          notificationId: `NOTIF-${queryId}-FWD`,
          queryId,
          recipientRole: 'OFFICER_IN_CHARGE',
          message: `${queryId} is awaiting assignment.`,
          at,
        },
      });
    }

    if (emailType === EMAIL_TYPE.OUTGOING_RESPONSE) {
      await persistQueryTransition({
        query: {
          ...query,
          workflowState: WORKFLOW_STATE.CLOSED,
          businessStatus: BUSINESS_STATUS.CLOSED,
          updatedAt: at,
        },
        auditEvent: {
          auditId: `AUD-${queryId}-CLOSED`,
          queryId,
          event: AUDIT_EVENT.QUERY_CLOSED,
          actor: userWithRole(ROLES.FRONT_OFFICE)?.name || 'Front Office',
          at,
          details: 'Query closed following dispatch.',
        },
      });
    }

    return { queryId, emailType, outcome: 'SENT', transport: 'mock', sentAt: at, to: [recipient] };
  }

  return {
    calls,
    sendAcknowledgement: ({ queryId }) => send(EMAIL_TYPE.ACKNOWLEDGEMENT, queryId),
    forwardQuery: ({ queryId }) => send(EMAIL_TYPE.FORWARD, queryId),
    sendResponse: ({ queryId }) => send(EMAIL_TYPE.OUTGOING_RESPONSE, queryId),

    /** What a person found in the Sent folder, recorded. Sends nothing. */
    resolveOutboundEmail: async (queryId, { emailType, outcome }) => {
      const { query } = await caseOf(queryId);
      const at = new Date().toISOString();

      if (outcome === 'NOT_SENT') {
        recordOutbound({ queryId, emailType, status: 'FAILED', updatedAt: at, resolvedBy: { outcome } });
        return { queryId, emailType, dispatch: { status: 'FAILED' } };
      }

      // Recorded exactly as a send would be — which for a response closes the case.
      plans[emailType] = { outcome: 'SENT' };
      const sent = await send(emailType, queryId);
      recordOutbound({ queryId, emailType, status: 'SENT', sentAt: at, resolvedBy: { outcome } });
      return { queryId, emailType, dispatch: { status: 'SENT' }, sent, subject: query.subject };
    },
  };
}
