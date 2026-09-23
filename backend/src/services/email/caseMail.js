import {
  QueryCase,
  QueryCounter,
  EmailMessage,
  ResponseVersion,
  Notification,
  OUTBOUND_TYPES,
} from '../../models/index.js';
import env, { EMAIL_TRANSPORTS } from '../../config/env.js';
import { IDENTITY_ROLES, identityForRole, formatSender } from '../../config/identities.js';
import * as emailService from './emailService.js';
import * as outbox from './outbox.js';
import { DELIVERY, describeError, describeFailure, labelDelivery } from './delivery.js';
import { sendTrace } from './sendTrace.js';
import * as audit from '../audit/auditService.js';
import { ACTOR_TYPES } from '../../constants/roles.js';
import { AUDIT_RESULTS } from '../../constants/auditActions.js';

/**
 * The three emails a case sends — acknowledgement, forward, final response —
 * each sent at most once, and each built from the stored case alone.
 *
 * Every path that sends one comes through here: intake (acceptMessage.js),
 * final approval (workflow/finalApproval.js) and the retry buttons
 * (emailController.js). So there is one guard for each email, not one per
 * path, and it is the outbox's claim, not a check a concurrent request can slip
 * past (see services/email/outbox.js).
 *
 * Recipients and content come from the database, never from the request: the
 * acknowledgement and the response go to the inquirer stored on the case at
 * intake, the forward to the configured Officer-in-Charge, and the response
 * body is the approved version. A caller can name *which* case — never who is
 * written to or what they are told.
 */

const PAST_APPROVAL = ['READY_FOR_DISPATCH', 'DISPATCHED', 'CLOSED'];
const COUNTER_KEY = 'counters';

const now = () => new Date().toISOString();
const pad = (n) => String(n).padStart(5, '0');

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
    { returnDocument: 'after', upsert: true },
  ).lean();

  return `${prefix}-${pad(counter.value[prefix])}`;
}

async function loadCase(queryId) {
  const query = await QueryCase.findOne({ queryId }).lean();
  if (!query) {
    throw Object.assign(new Error(`Query case ${queryId} does not exist`), { status: 404 });
  }
  return query;
}

/**
 * Did that send actually leave the machine?
 *
 * `getTransport` falls back to the mock when a role holds no usable credential,
 * and the mock returns an ordinary success — correct for the mocked tail of a
 * development workflow, and wrong here: it would record the inquirer as told.
 * So a mock result counts only when mock delivery is what this email's channel
 * asked for. Under nic or nic-browser it means nothing was sent.
 *
 * The channel is the plan's own `transport`, not env.EMAIL_TRANSPORT: a
 * NICeMail case sends through the browser whatever the global says, so keying
 * on the global would accept a mock result for a mailbox that never saw it.
 */
function requireReal(sent, channel = env.EMAIL_TRANSPORT) {
  if (channel === EMAIL_TRANSPORTS.MOCK || sent?.transport !== 'mock') return sent;
  throw labelDelivery(
    new Error(
      'The Front Office mailbox has no usable credential, so nothing was sent. ' +
        'Refusing to record a send that did not happen.',
    ),
    DELIVERY.NOT_SENT,
  );
}

const transportLabel = (sourceMailbox) =>
  sourceMailbox?.source === 'nic-browser' ? 'nic-browser' : env.EMAIL_TRANSPORT;

/**
 * What to do about a send that may have gone out.
 *
 * The same for every channel, because none of them settles this by itself. The
 * Gmail transport used to search its own Sent folder and reconcile an uncertain
 * send with no human involved; nothing that survives it can, so an UNCERTAIN
 * send is now always somebody's work item.
 */
const UNCERTAIN_ADVICE = 'Check the Sent folder before retrying, then record whether it was sent.';

/**
 * The one artefact of a kind for a case. Written once: an existing record — from
 * before the outbox, or from an earlier call that recorded and then failed —
 * is left as it is.
 */
async function recordArtefact({ queryId, emailType, messageId, fields }) {
  const existing = await EmailMessage.findOne({ queryId, emailType }).lean();
  if (existing) return { inserted: false };

  try {
    await EmailMessage.create({ messageId, queryId, emailType, direction: 'OUTBOUND', ...fields });
    return { inserted: true };
  } catch (error) {
    if (outbox.isDuplicateKey(error)) return { inserted: false };
    throw error;
  }
}

const artefactFields = ({ query, doc, sent, fallback }) => ({
  threadId: query.threadId ?? null,
  timestamp: sent?.sentAt || doc?.sentAt || now(),
  from: sent?.from || fallback.from,
  to: [sent?.to ?? fallback.to].flat().filter(Boolean),
  subject: sent?.subject || fallback.subject,
  body: sent?.body ?? fallback.body,
  // What the transport says it sent, or else what the plan gave it. A
  // transport that does not echo the attachments back would otherwise leave the
  // case's record of the forward claiming none were sent.
  attachments: sent?.attachments || fallback.attachments || [],
  providerMessageId: sent?.providerMessageId || doc?.providerMessageId || null,
  providerThreadId: sent?.providerThreadId || doc?.providerThreadId || null,
});

const usableSummary = (summary) => summary?.status === 'GENERATED' || summary?.status === 'FALLBACK';

// ── The three plans ──────────────────────────────────────────────────────────
//
// A plan is everything `outbox.dispatchOnce` needs for one email of one case.
// The same plan serves a send and a manual resolution, so the bookkeeping for
// "it went out" exists once per email type.

function acknowledgementPlan(query, actor) {
  const { queryId } = query;
  const sourceMailbox = query.sourceMailbox || null;
  const to = query.inquirer?.email || null;
  if (!to) return { missing: 'The case carries no inquirer address.' };

  const composed = emailService.composeAcknowledgement({ to, queryId, sourceMailbox });

  return {
    emailType: OUTBOUND_TYPES.ACKNOWLEDGEMENT,
    label: 'acknowledgement',
    recipients: [to],
    subject: composed.subject,
    transport: transportLabel(sourceMailbox),
    domain: emailService.senderDomainFor(sourceMailbox),
    send: async ({ rfcMessageId, onStage }) =>
      requireReal(
        await emailService.sendAcknowledgement({ to, queryId, sourceMailbox, rfcMessageId, onStage }),
        transportLabel(sourceMailbox),
      ),
    reconcile: (doc) => emailService.reconcileDelivery(doc, { sourceMailbox }),
    finalize: async (doc, sent) => {
      const { inserted } = await recordArtefact({
        queryId,
        emailType: 'ACKNOWLEDGEMENT',
        messageId: `MSG-ACK-${queryId}`,
        fields: artefactFields({ query, doc, sent, fallback: composed }),
      });
      if (inserted) {
        await audit.record({ ...record(actor, 'ACKNOWLEDGEMENT_SENT'), queryId, details: `Acknowledgement sent to ${to}.` });
      }
    },
    onFailure: async (doc, error, delivery) => {
      await audit.record({
        ...record(actor, 'EMAIL_SEND_FAILED'),
        queryId,
        result: AUDIT_RESULTS.FAILURE,
        error: describeFailure(error),
        details:
          delivery === DELIVERY.UNCERTAIN
            ? `The acknowledgement to ${to} may have been sent but was not confirmed. ${UNCERTAIN_ADVICE}`
            : `The acknowledgement to ${to} could not be sent.`,
      });
    },
  };
}

async function forwardPlan(query, actor, source = null) {
  const { queryId } = query;
  const officer = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE);
  if (!officer?.email) return { missing: 'No Officer-in-Charge address is configured.' };

  // The enquiry as it arrived; intake hands it over, a retry reads it back.
  const inbound = source || (await EmailMessage.findOne({ queryId, emailType: 'INCOMING_QUERY' }).lean());
  const subject = inbound?.subject || query.subject || '(no subject)';
  const body = inbound?.body ?? query.description ?? '';
  const attachments = inbound?.attachments ?? query.attachments ?? [];
  const aiSummary = usableSummary(query.aiSummary) ? query.aiSummary : null;
  const fullSubject = emailService.forwardSubject({ subject, queryId });
  const sourceMailbox = query.sourceMailbox || null;
  // Whoever sends this case's mail. For a NICeMail case that is the mailbox
  // itself, which is what the compose form's From is checked against before
  // Send — record any other address and the case would name an account that
  // did not send the message.
  const frontOffice = emailService.senderFor(sourceMailbox);
  const channel = transportLabel(sourceMailbox);

  return {
    emailType: OUTBOUND_TYPES.FORWARD,
    label: 'forward to the Officer-in-Charge',
    recipients: [officer.email],
    subject: fullSubject,
    // Internal mail, but on the same channel as the rest of the case: a
    // NICeMail case tells the Officer-in-Charge from the NICeMail mailbox.
    transport: channel,
    domain: emailService.senderDomainFor(sourceMailbox),
    send: async ({ rfcMessageId, onStage }) =>
      requireReal(
        await emailService.forwardToOfficerInCharge({
          queryId,
          subject,
          body,
          providerThreadId: inbound?.providerThreadId || null,
          attachments,
          // The summary stored on the case, so the covering note and the case
          // carry the same text and the forward costs no second model call.
          aiSummary,
          rfcMessageId,
          sourceMailbox,
          onStage,
        }),
        channel,
      ),
    reconcile: (doc) => emailService.reconcileDelivery(doc, { sourceMailbox }),
    finalize: async (doc, sent) => {
      const { inserted } = await recordArtefact({
        queryId,
        emailType: 'FORWARD',
        messageId: `MSG-FWD-${queryId}`,
        fields: artefactFields({
          query,
          doc,
          sent,
          fallback: {
            from: formatSender(frontOffice),
            to: officer.email,
            subject: fullSubject,
            body,
            attachments,
          },
        }),
      });
      // Only forward in time — a case that has moved on stays where it is.
      await QueryCase.updateOne(
        { queryId, workflowState: { $in: ['RECEIVED', 'FRONT_OFFICE_VERIFICATION'] } },
        { $set: { workflowState: 'PENDING_ASSIGNMENT', updatedAt: now() } },
      );
      if (inserted) {
        await audit.record({
          ...record(actor, 'QUERY_FORWARDED'),
          queryId,
          details: 'Forwarded to the Officer-in-Charge for assignment.',
        });
        // The forward is an email; this is the in-app half of it. Without it
        // the case reaches PENDING_ASSIGNMENT with nothing in the Officer-in-
        // Charge's queue to say so, and it waits until someone goes looking.
        await Notification.create({
          notificationId: await mint('NOTIF'),
          queryId,
          recipientRole: 'OFFICER_IN_CHARGE',
          title: `${queryId} awaiting assignment`,
          message: `${queryId} is awaiting assignment.`,
          at: now(),
        }).catch(() => {});
      }
    },
    onFailure: async (doc, error, delivery) => {
      await audit.record({
        ...record(actor, 'EMAIL_SEND_FAILED'),
        queryId,
        result: AUDIT_RESULTS.FAILURE,
        error: describeFailure(error),
        details:
          delivery === DELIVERY.UNCERTAIN
            ? `The forward to the Officer-in-Charge may have been sent but was not confirmed. ${UNCERTAIN_ADVICE}`
            : 'The forward to the Officer-in-Charge could not be sent.',
      });
      // An uncertain forward leaves the case short of PENDING_ASSIGNMENT with
      // nothing in anyone's queue: the Officer-in-Charge may or may not have
      // been told, and only a person can settle it. The response does the same
      // on its own uncertain path.
      if (delivery === DELIVERY.UNCERTAIN) {
        await Notification.create({
          notificationId: await mint('NOTIF'),
          queryId,
          recipientRole: 'FRONT_OFFICE',
          title: `${queryId} forward not confirmed`,
          message: `${queryId}: the forward to the Officer-in-Charge may already have gone out. ${UNCERTAIN_ADVICE}`,
          type: 'WARNING',
          at: now(),
        }).catch(() => {});
      }
    },
  };
}

/** The response that was approved — locked by final approval, else the latest draft. */
async function approvedVersion(queryId) {
  const versions = await ResponseVersion.find({ queryId }).sort({ createdAt: 1 }).lean();
  return versions.filter((v) => v.status === 'FINAL_APPROVED').at(-1) || versions.at(-1) || null;
}

async function responsePlan(query, actor) {
  const { queryId } = query;
  const sourceMailbox = query.sourceMailbox || null;

  if (!PAST_APPROVAL.includes(query.workflowState)) {
    throw Object.assign(
      new Error(`${queryId} is ${query.workflowState}; a response is sent only after final approval`),
      { status: 409 },
    );
  }

  const approved = await approvedVersion(queryId);
  if (!approved) {
    throw Object.assign(new Error(`${queryId} has no approved response to send`), { status: 409 });
  }

  // Whoever wrote in — the address stored on the case at intake, read off the
  // original From header. There is no configured recipient on this path.
  const to = query.inquirer?.email || null;
  if (!to) return { missing: 'The case carries no inquirer address.' };

  const subject = `Re: ${query.subject} [${queryId}]`;
  const body = approved.content || '';
  const sender = formatSender(emailService.senderFor(sourceMailbox));

  return {
    emailType: OUTBOUND_TYPES.OUTGOING_RESPONSE,
    label: 'final response',
    recipients: [to],
    subject,
    transport: transportLabel(sourceMailbox),
    domain: emailService.senderDomainFor(sourceMailbox),
    send: async ({ rfcMessageId, onStage }) =>
      requireReal(
        await emailService.sendResponse({
          to,
          subject,
          body,
          providerThreadId: query.providerThreadId || null,
          sourceMailbox,
          rfcMessageId,
          onStage,
        }),
        transportLabel(sourceMailbox),
      ),
    reconcile: (doc) => emailService.reconcileDelivery(doc, { sourceMailbox }),
    finalize: async (doc, sent) => {
      const { inserted } = await recordArtefact({
        queryId,
        emailType: 'OUTGOING_RESPONSE',
        messageId: `MSG-RESP-${queryId}`,
        fields: artefactFields({ query, doc, sent, fallback: { from: sender, to, subject, body } }),
      });

      // Closed only now, and only forward: the email is known to have gone.
      const at = now();
      await QueryCase.updateOne(
        { queryId, workflowState: 'READY_FOR_DISPATCH' },
        { $set: { workflowState: 'DISPATCHED', updatedAt: at } },
      );
      await QueryCase.updateOne(
        { queryId, workflowState: { $in: ['READY_FOR_DISPATCH', 'DISPATCHED'] } },
        { $set: { workflowState: 'CLOSED', businessStatus: 'CLOSED', updatedAt: at } },
      );

      if (inserted) {
        await audit.record({
          ...record(actor, 'RESPONSE_DISPATCHED'),
          queryId,
          details: `Approved response ${approved.version} emailed to ${to}.`,
        });
        await audit.record({ ...record(actor, 'QUERY_CLOSED'), queryId, details: 'Query closed following dispatch.' });
        await Notification.create({
          notificationId: await mint('NOTIF'),
          queryId,
          recipientRole: 'FRONT_OFFICE',
          title: `${queryId} dispatched`,
          message: `${queryId} has been answered and closed.`,
          at,
        }).catch(() => {});
      }
    },
    onFailure: async (doc, error, delivery) => {
      const unconfirmed = delivery === DELIVERY.UNCERTAIN;

      await audit.record({
        ...record(actor, 'EMAIL_SEND_FAILED'),
        queryId,
        result: AUDIT_RESULTS.FAILURE,
        error: describeFailure(error),
        details: unconfirmed
          ? `The approved response to ${to} may have been sent but was not confirmed. The case stays ready for dispatch. ${UNCERTAIN_ADVICE}`
          : `The approved response to ${to} could not be sent. The case stays ready for dispatch.`,
      });

      await Notification.create({
        notificationId: await mint('NOTIF'),
        queryId,
        recipientRole: 'FRONT_OFFICE',
        title: unconfirmed ? `${queryId} may have been sent` : `${queryId} could not be sent`,
        message: unconfirmed
          ? `${queryId}: the response may already have gone out. ${UNCERTAIN_ADVICE}`
          : `${queryId} is approved but the response did not go out. Retry from the Dispatch page.`,
        type: 'WARNING',
        at: now(),
      }).catch(() => {});
    },
  };
}

const PLANS = {
  [OUTBOUND_TYPES.ACKNOWLEDGEMENT]: acknowledgementPlan,
  [OUTBOUND_TYPES.FORWARD]: forwardPlan,
  [OUTBOUND_TYPES.OUTGOING_RESPONSE]: responsePlan,
};

/** The log tag of each email — `ACK START …`, `RESPONSE RESULT …`. */
const TRACE_TAGS = {
  [OUTBOUND_TYPES.ACKNOWLEDGEMENT]: 'ACK',
  [OUTBOUND_TYPES.FORWARD]: 'FORWARD',
  [OUTBOUND_TYPES.OUTGOING_RESPONSE]: 'RESPONSE',
};

/**
 * One guarded send, logged from START to RESULT. The stages in between come
 * from the transport through `onStage` — for a NICeMail case, every step the
 * browser agent takes — so a failure names the step it stopped at.
 */
async function run(query, plan, emailType) {
  const trace = sendTrace(TRACE_TAGS[emailType] || emailType, { caseId: query.queryId });
  trace('START', {
    inquirerEmail: query.inquirer?.email || null,
    recipients: plan.recipients,
    subject: plan.subject,
    transport: plan.transport,
  });

  if (plan.missing) {
    trace('RESULT', { status: 'NO_RECIPIENT', error: plan.missing });
    return { outcome: 'NO_RECIPIENT', error: plan.missing };
  }

  let result;
  try {
    result = await outbox.dispatchOnce({
      queryId: query.queryId,
      emailType: plan.emailType,
      recipients: plan.recipients,
      subject: plan.subject,
      transport: plan.transport,
      domain: plan.domain,
      send: (attempt) => plan.send({ ...attempt, onStage: trace }),
      reconcile: plan.reconcile,
      finalize: plan.finalize,
      onFailure: plan.onFailure,
    });
  } catch (error) {
    trace('RESULT', { status: 'ERROR', error: describeError(error) });
    throw error;
  }

  trace('RESULT', {
    status: result.outcome,
    ledgerStatus: result.dispatch?.status ?? null,
    attempts: result.dispatch?.attempts ?? null,
    providerMessageId: result.sent?.providerMessageId || result.dispatch?.providerMessageId || null,
    stage: result.stage ?? null,
    error: result.error ?? null,
  });
  return result;
}

/** Acknowledge the inquirer of a stored case. */
export async function acknowledge({ queryId, actor = null }) {
  const query = await loadCase(queryId);
  return run(query, acknowledgementPlan(query, actor), OUTBOUND_TYPES.ACKNOWLEDGEMENT);
}

/**
 * Forward a stored case to the Officer-in-Charge. `source` is the inbound
 * message when the caller already holds it (intake); a retry reads it back.
 */
export async function forward({ queryId, actor = null, source = null }) {
  const query = await loadCase(queryId);
  return run(query, await forwardPlan(query, actor, source), OUTBOUND_TYPES.FORWARD);
}

/** Send a finally-approved case's response, and close the case once it has gone. */
export async function dispatchResponse({ queryId, actor = null }) {
  const query = await loadCase(queryId);
  return run(query, await responsePlan(query, actor), OUTBOUND_TYPES.OUTGOING_RESPONSE);
}

/**
 * Settle an UNCERTAIN send from what a person found in the Sent folder.
 *
 * SENT records the email exactly as a successful send would — for a final
 * response that closes the case. NOT_SENT makes it an ordinary failure, which
 * the retry buttons can send again.
 */
export async function resolve({ queryId, emailType, outcome, actor = null }) {
  const query = await loadCase(queryId);
  const buildPlan = PLANS[emailType];
  if (!buildPlan) {
    throw Object.assign(new Error(`Unknown email type ${emailType}`), { status: 400 });
  }

  const plan = await buildPlan(query, actor);
  const result = await outbox.resolveUncertain({
    queryId,
    emailType,
    outcome,
    actor,
    finalize: plan.finalize || null,
  });

  await audit.record({
    ...record(actor, outcome === DELIVERY.NOT_SENT ? 'EMAIL_DELIVERY_DENIED' : 'EMAIL_DELIVERY_CONFIRMED'),
    queryId,
    details:
      outcome === DELIVERY.NOT_SENT
        ? `Recorded from the Sent folder that the ${plan.label || 'email'} was not sent; it can be sent again.`
        : `Recorded from the Sent folder that the ${plan.label || 'email'} was sent.`,
  });

  return result;
}

export { PAST_APPROVAL };
