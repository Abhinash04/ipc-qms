/**
 * An in-process stand-in for `POST /mailbox/messages/:id/accept`.
 *
 * Accepting is one server call now: it mints the Case ID, creates the case,
 * records the ACCEPTED decision, acknowledges whoever wrote in and forwards to
 * the Officer-in-Charge. None of that can be proven from jsdom — it happens in
 * MongoDB, and `backend/src/test/acceptMessage.test.js` is where those rules
 * are asserted. What a frontend test can still prove is the client half: the
 * endpoint is called once per message, carrying that message, and the UI
 * reports back exactly what the server answered. This is the server that half
 * talks to.
 *
 * It writes the case through `fakeQueryApi` rather than into the store, because
 * `acceptMailboxMessage` re-reads `GET /queries` after a created case instead of
 * reconstructing it locally — anything seeded elsewhere is discarded by that
 * refresh.
 */

import { persistQueryTransition } from '@/test/fakeQueryApi';
import { buildSeedState } from '@/constants/mockDomain';
import { createEmailMessage, EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { AUDIT_EVENT, BUSINESS_STATUS, PRIORITY, WORKFLOW_STATE } from '@/constants/statusEnums';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';

const pad = (n) => String(n).padStart(5, '0');

/** `Name <addr>` or a bare address → the address, as the server parses it. */
const addressOf = (header) =>
  (String(header || '').match(/<([^>]+)>/)?.[1] ?? String(header || '')).trim();

const nameOf = (header) => {
  const raw = String(header || '').trim();
  return (raw.includes('<') ? raw.split('<')[0].trim().replace(/^"|"$/g, '') : '') || addressOf(raw);
};

const addressFor = (role) => MOCK_USERS.find((u) => u.role === role)?.email;

const plus = (timestamp, minutes) =>
  new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString();

async function writeCase({ queryId, sequence, mailboxMessageId, message, acknowledged, forwarded }) {
  const receivedAt = message.receivedAt || new Date().toISOString();
  const threadId = `THREAD-${new Date(receivedAt).getUTCFullYear()}-${pad(sequence)}`;
  const subject = message.subject || '(no subject)';
  const senderEmail = addressOf(message.from);
  const ipcAddress = addressFor(ROLES.FRONT_OFFICE);

  const incoming = createEmailMessage({
    messageId: `MSG-${pad(sequence)}`,
    threadId,
    queryId,
    direction: EMAIL_DIRECTION.INBOUND,
    emailType: EMAIL_TYPE.INCOMING_QUERY,
    from: message.from,
    to: message.to ? [message.to].flat() : [ipcAddress],
    subject,
    body: message.body,
    attachments: message.attachments || [],
    timestamp: receivedAt,
    providerMessageId: message.providerMessageId || mailboxMessageId,
    providerThreadId: message.providerThreadId || null,
  });
  incoming.sourceMessageId = mailboxMessageId;

  const messages = [incoming];
  const events = [AUDIT_EVENT.QUERY_RECEIVED, AUDIT_EVENT.QUERY_REGISTERED];

  if (acknowledged) {
    messages.push(
      createEmailMessage({
        messageId: `MSG-ACK-${queryId}`,
        threadId,
        queryId,
        direction: EMAIL_DIRECTION.OUTBOUND,
        emailType: EMAIL_TYPE.ACKNOWLEDGEMENT,
        from: ipcAddress,
        to: [senderEmail],
        subject: `Acknowledgement of Query Received – Indian Pharmacopoeia Commission [${queryId}]`,
        body: 'This is to acknowledge that we have received your email/query.',
        timestamp: plus(receivedAt, 5),
      }),
    );
    events.push(AUDIT_EVENT.ACKNOWLEDGEMENT_SENT);
  }

  if (forwarded) {
    messages.push(
      createEmailMessage({
        messageId: `MSG-FWD-${queryId}`,
        threadId,
        queryId,
        direction: EMAIL_DIRECTION.OUTBOUND,
        emailType: EMAIL_TYPE.FORWARD,
        from: ipcAddress,
        to: [addressFor(ROLES.OFFICER_IN_CHARGE)],
        subject: `Fwd: ${subject} [${queryId}]`,
        body: message.body || '',
        timestamp: plus(receivedAt, 10),
      }),
    );
    events.push(AUDIT_EVENT.QUERY_FORWARDED);
  }

  await persistQueryTransition({
    query: {
      queryId,
      threadId,
      sourceEmailId: incoming.messageId,
      sourceMailboxMessageId: mailboxMessageId,
      subject,
      description: message.body || '',
      source: 'Email',
      // Whoever wrote in, read off the From header. No lookup, no configured
      // inquirer address — that is the whole point of the server-side accept.
      inquirer: { id: null, name: nameOf(message.from), email: senderEmail },
      category: null,
      priority: PRIORITY.NORMAL,
      businessStatus: BUSINESS_STATUS.IN_PROGRESS,
      // A forward that failed leaves the case exactly where the manual
      // "Forward to Officer-in-Charge" button acts on it.
      workflowState: forwarded
        ? WORKFLOW_STATE.PENDING_ASSIGNMENT
        : WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
      currentAssigneeId: null,
      currentWorkflowStepId: null,
      assignmentDecision: null,
      aiSummary: null,
      attachments: message.attachments || [],
      createdAt: receivedAt,
      updatedAt: plus(receivedAt, 10),
      dueDate: null,
    },
    addThreads: [{ threadId, queryId, subject, createdAt: receivedAt }],
    addMessages: messages,
    // The in-app half of the forward: the case is at PENDING_ASSIGNMENT, and
    // the Officer-in-Charge's queue has to say so.
    ...(forwarded
      ? {
          notification: {
            notificationId: `NOTIF-${queryId}-FWD`,
            queryId,
            recipientRole: 'OFFICER_IN_CHARGE',
            message: `${queryId} is awaiting assignment.`,
            at: plus(receivedAt, 10),
          },
        }
      : {}),
    // Server and client share one counter document, so the store must come back
    // from the refresh knowing which ids are already spent — otherwise the next
    // client-minted message id collides with the one written here.
    counters: { ...buildSeedState().counters, QRY: sequence, THREAD: sequence, MSG: sequence },
  });

  for (const [index, event] of events.entries()) {
    await persistQueryTransition({
      auditEvent: {
        auditId: `AUD-${queryId}-${index + 1}`,
        queryId,
        event,
        actor: MOCK_USERS.find((u) => u.role === ROLES.FRONT_OFFICE)?.name || 'Front Office',
        at: plus(receivedAt, index),
        details: null,
      },
    });
  }
}

/**
 * Build one accept endpoint.
 *
 * `acknowledged` and `forwarded` are the two steps that can fail on their own
 * without losing the case; `errors` is what the server reports about them. The
 * returned function is safe to call twice with the same id — the second call is
 * answered from the decision already stored, which is what makes the real
 * endpoint safe to retry.
 */
export function fakeAcceptEndpoint({ acknowledged = true, forwarded = true, errors = [] } = {}) {
  const issued = new Map();
  let minted = 0;

  return async function accept(mailboxMessageId, message = {}) {
    const known = issued.get(mailboxMessageId);
    if (known) {
      return { queryId: known, created: false, alreadyDecided: true, acknowledged, forwarded, errors };
    }

    minted += 1;
    const year = new Date(message.receivedAt || Date.now()).getUTCFullYear();
    const queryId = `QRY-${year}-${pad(minted)}`;
    issued.set(mailboxMessageId, queryId);

    await writeCase({ queryId, sequence: minted, mailboxMessageId, message, acknowledged, forwarded });

    return { queryId, created: true, alreadyDecided: false, acknowledged, forwarded, errors };
  };
}
