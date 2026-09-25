
import { fetchAllQueries, persistQueryTransition } from '@/test/fakeQueryApi';
import { createEmailMessage, EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import {
  AUDIT_EVENT,
  BUSINESS_STATUS,
  RESPONSE_STATUS,
  WORKFLOW_STATE,
} from '@/constants/statusEnums';
import { MOCK_USERS } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER } from '@/test/frontOfficeUser';
import { ROLES } from '@/constants/roles';

const pad = (n) => String(n).padStart(5, '0');

const NEEDS_APPROVAL = [WORKFLOW_STATE.PENDING_FINAL_APPROVAL, WORKFLOW_STATE.APPROVED];
const ALREADY_APPROVED = [
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];

const userWithRole = (role) => [...MOCK_USERS, FRONT_OFFICE_USER].find((user) => user.role === role);

const defaultSend = async ({ to, subject, body }) => ({
  from: userWithRole(ROLES.FRONT_OFFICE)?.email,
  to: [to].flat(),
  subject,
  body,
  providerMessageId: 'fake-final-approval-response',
  sentAt: new Date().toISOString(),
});

export function fakeFinalApprovalEndpoint({ send = defaultSend, actor } = {}) {
  const actorName = actor || userWithRole(ROLES.OFFICER_IN_CHARGE)?.name || 'Officer-in-Charge';

  return async function approve(queryId, { comment = '' } = {}) {
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = await fetchAllQueries();
    const errors = [];

    let clock = Date.now();
    const at = () => new Date((clock += 1)).toISOString();

    let audits = 0;
    const auditId = () => `AUD-${queryId}-FA-${(audits += 1)}`;

    const query = snapshot.queries.find((q) => q.queryId === queryId);
    if (!query) throw new Error(`Query case ${queryId} does not exist`);

    const needsApproval = NEEDS_APPROVAL.includes(query.workflowState);
    if (!needsApproval && !ALREADY_APPROVED.includes(query.workflowState)) {
      throw new Error(
        `${queryId} is ${query.workflowState} and cannot be finally approved — ` +
          `expected one of ${NEEDS_APPROVAL.join(', ')}`,
      );
    }

    const versions = snapshot.responseVersions.filter((v) => v.queryId === queryId);
    const approvedVersion = versions.at(-1);
    if (!approvedVersion) {
      throw new Error(`${queryId} has no drafted response to approve`);
    }

    if (needsApproval) {
      await persistQueryTransition({
        query: { ...query, workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH, updatedAt: at() },
        upsertVersions: [
          { ...approvedVersion, status: RESPONSE_STATUS.FINAL_APPROVED, approvedAt: at() },
        ],
        upsertSteps: snapshot.workflowSteps
          .filter((step) => step.queryId === queryId && step.status !== 'COMPLETED')
          .map((step) => ({ ...step, status: 'COMPLETED', completedAt: at() })),
        auditEvent: {
          auditId: auditId(),
          queryId,
          event: AUDIT_EVENT.FINAL_APPROVAL_GRANTED,
          actor: actorName,
          at: at(),
          details:
            `Final approval granted; ${approvedVersion.version} locked and ready for dispatch.` +
            (comment ? ` ${comment}` : ''),
        },
      });
    }

    const alreadySent = snapshot.emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
    );
    if (alreadySent) {
      return {
        queryId,
        approved: true,
        dispatched: false,
        alreadyDispatched: true,
        workflowState: WORKFLOW_STATE.CLOSED,
        recipient: [alreadySent.to].flat()[0] ?? null,
        errors,
      };
    }

    const recipient = query.inquirer?.email || null;
    if (!recipient) {
      errors.push({ step: 'dispatch', error: 'The case carries no inquirer address.' });
      return {
        queryId,
        approved: true,
        dispatched: false,
        alreadyDispatched: false,
        workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH,
        recipient: null,
        errors,
      };
    }

    const subject = `Re: ${query.subject} [${queryId}]`;

    try {
      const sent = await send({
        to: recipient,
        subject,
        body: approvedVersion.content || '',
        attachments: [],
        providerThreadId: query.providerThreadId || null,
      });

      const nextMsg = (snapshot.counters?.MSG || 0) + 1;
      const nextNotif = (snapshot.counters?.NOTIF || 0) + 1;

      const message = createEmailMessage({
        messageId: `MSG-${pad(nextMsg)}`,
        threadId: query.threadId ?? null,
        queryId,
        direction: EMAIL_DIRECTION.OUTBOUND,
        emailType: EMAIL_TYPE.OUTGOING_RESPONSE,
        from: sent?.from || userWithRole(ROLES.FRONT_OFFICE)?.email,
        to: [sent?.to ?? recipient].flat(),
        subject: sent?.subject || subject,
        body: sent?.body ?? approvedVersion.content ?? '',
        timestamp: sent?.sentAt || at(),
        providerMessageId: sent?.providerMessageId || null,
        providerThreadId: sent?.providerThreadId || null,
      });

      await persistQueryTransition({
        addMessages: [message],
        auditEvent: {
          auditId: auditId(),
          queryId,
          event: AUDIT_EVENT.RESPONSE_DISPATCHED,
          actor: actorName,
          at: at(),
          details: `Approved response ${approvedVersion.version} emailed to ${recipient}.`,
        },
        counters: { ...snapshot.counters, MSG: nextMsg, NOTIF: nextNotif },
      });

      await persistQueryTransition({
        query: {
          ...query,
          workflowState: WORKFLOW_STATE.CLOSED,
          businessStatus: BUSINESS_STATUS.CLOSED,
          updatedAt: at(),
        },
        auditEvent: {
          auditId: auditId(),
          queryId,
          event: AUDIT_EVENT.QUERY_CLOSED,
          actor: actorName,
          at: at(),
          details: 'Query closed following dispatch.',
        },
        notification: {
          notificationId: `NOTIF-${pad(nextNotif)}`,
          queryId,
          recipientRole: 'FRONT_OFFICE',
          message: `${queryId} has been answered and closed.`,
          at: at(),
        },
      });

      return {
        queryId,
        approved: true,
        dispatched: true,
        alreadyDispatched: false,
        workflowState: WORKFLOW_STATE.CLOSED,
        recipient,
        errors,
      };
    } catch (error) {
      await persistQueryTransition({
        auditEvent: {
          auditId: auditId(),
          queryId,
          event: 'EMAIL_SEND_FAILED',
          actor: actorName,
          at: at(),
          details: `The approved response to ${recipient} could not be sent. The case stays ready for dispatch.`,
        },
      });

      errors.push({ step: 'dispatch', error: error?.message || String(error) });

      return {
        queryId,
        approved: true,
        dispatched: false,
        alreadyDispatched: false,
        workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH,
        recipient,
        errors,
      };
    }
  };
}
