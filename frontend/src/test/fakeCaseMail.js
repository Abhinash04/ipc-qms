
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
import { FRONT_OFFICE_USER } from '@/test/frontOfficeUser';
import { ROLES } from '@/constants/roles';

const userWithRole = (role) => [...MOCK_USERS, FRONT_OFFICE_USER].find((user) => user.role === role);
const frontOffice = () => userWithRole(ROLES.FRONT_OFFICE)?.email;

const STATUS = {
  SENT: 201,
  ALREADY_SENT: 200,
  IN_PROGRESS: 409,
  BLOCKED_UNCERTAIN: 409,
  FAILED: 503,
  UNCERTAIN: 504,
};

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

function refusal(status, error) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error } },
  });
}

const PAST_APPROVAL = [WORKFLOW_STATE.READY_FOR_DISPATCH, WORKFLOW_STATE.DISPATCHED, WORKFLOW_STATE.CLOSED];

const DEFAULT_REASONS = {
  FAILED: 'The mail server could not be reached.',
  UNCERTAIN:
    'The mailbox may have sent this message but did not confirm it in time. Check the Sent folder before retrying.',
  BLOCKED_UNCERTAIN:
    'An earlier attempt may already have sent this email, and it could not be verified. Check the Sent folder, then record whether it was sent.',
  IN_PROGRESS: 'This email is being sent by another request. Refresh in a moment.',
};

export function installFakeCaseMail(mailboxService, options) {
  const caseMail = fakeCaseMail(options);
  vi.mocked(mailboxService.sendAcknowledgement).mockImplementation(caseMail.sendAcknowledgement);
  vi.mocked(mailboxService.forwardQuery).mockImplementation(caseMail.forwardQuery);
  vi.mocked(mailboxService.sendResponse).mockImplementation(caseMail.sendResponse);
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

    resolveOutboundEmail: async (queryId, { emailType, outcome }) => {
      const { query } = await caseOf(queryId);
      const at = new Date().toISOString();

      if (outcome === 'NOT_SENT') {
        recordOutbound({ queryId, emailType, status: 'FAILED', updatedAt: at, resolvedBy: { outcome } });
        return { queryId, emailType, dispatch: { status: 'FAILED' } };
      }

      plans[emailType] = { outcome: 'SENT' };
      const sent = await send(emailType, queryId);
      recordOutbound({ queryId, emailType, status: 'SENT', sentAt: at, resolvedBy: { outcome } });
      return { queryId, emailType, dispatch: { status: 'SENT' }, sent, subject: query.subject };
    },
  };
}
