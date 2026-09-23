import env, { EMAIL_TRANSPORTS } from '../../config/env.js';
import browserConfig from '../../config/browserConfig.js';
import {
  IDENTITY_ROLES,
  identityForRole,
  formatSender,
  publicDirectory,
} from '../../config/identities.js';
import * as mockTransport from './transports/mockTransport.js';
import { outboundAllowed } from './nic/outboundGuard.js';
import { buildAcknowledgement } from './templates/acknowledgement.js';
import * as gemmaService from '../ai/gemmaService.js';
import { resolveAttachments, toPublicRecord } from '../attachments/resolveAttachments.js';
import * as audit from '../audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../../constants/auditActions.js';
import { ACTOR_TYPES } from '../../constants/roles.js';

/**
 * Email orchestration.
 *
 * Sender identity comes from the acting stakeholder, never from the caller:
 * the acknowledgement, the forward and the final response are all sent by the
 * Front Officer — for a NICeMail case, by that mailbox itself.
 */

/**
 * The configured transport, for everything the case mailbox does not claim.
 *
 * NICeMail is one mailbox, not one account per role: there is no per-role
 * credential and so no per-role fallback. Every role sends from the same
 * configured address, with the role carried in the display name.
 *
 * `nodemailer` is behind a dynamic import so it is never evaluated unless a
 * real SMTP send is actually happening.
 */
async function getTransport(name = env.EMAIL_TRANSPORT) {
  if (name === EMAIL_TRANSPORTS.NIC) return import('./transports/nicTransport.js');
  return mockTransport;
}

/**
 * External mail on a case goes out through the mailbox the enquiry came in on.
 *
 * `sourceMailbox` is the `{ source, address }` stored on the case at intake.
 * A case from the NICeMail browser mailbox answers its inquirer through that
 * signed-in browser session; every other case — mock, NIC SMTP, and cases
 * from before the field existed — uses EMAIL_TRANSPORT.
 *
 * All three case emails pass it, the internal forward included. The forward
 * used to stay on EMAIL_TRANSPORT because that is where Gmail was; with Gmail
 * gone, a NICeMail case that answered its inquirer through the browser but
 * told the Officer-in-Charge through a different channel would be two
 * channels, and the second one has no credential.
 */
const NIC_BROWSER = 'nic-browser';
const isNicBrowser = (sourceMailbox) => sourceMailbox?.source === NIC_BROWSER;

async function transportFor(sourceMailbox) {
  if (isNicBrowser(sourceMailbox)) return import('./transports/nicBrowserTransport.js');
  return getTransport(env.EMAIL_TRANSPORT);
}

/** Who external mail on this case is from: the mailbox's own Front Office. */
function senderFor(sourceMailbox) {
  if (isNicBrowser(sourceMailbox)) {
    return { email: sourceMailbox.address, name: browserConfig.frontOfficeName };
  }
  return identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
}

function getEmailConfig() {
  const inquirer = identityForRole(IDENTITY_ROLES.INQUIRER);
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  return {
    transport: env.EMAIL_TRANSPORT,

    /**
     * The other channel, which EMAIL_TRANSPORT says nothing about.
     *
     * A case that arrived in the NICeMail mailbox is answered through the
     * browser agent whatever the transport is set to, so a deployment can run
     * EMAIL_TRANSPORT=mock and still send real mail from a .gov.in account.
     * Without these two a read-only admin page can only report the transport,
     * and would call that deployment silent — which is how the settings page
     * came to promise "nothing leaves this machine" on a live mailbox.
     *
     * Booleans, not addresses or credentials: enough to state the posture,
     * nothing worth withholding.
     */
    nicBrowserMailbox: browserConfig.mailboxEnabled,
    outboundAllowed: outboundAllowed(),

    // Where an enquiry is addressed. With real stakeholders this is the Front
    // Officer; IPC_QUERY_EMAIL remains the shared mock mailbox address.
    ipcQueryEmail: frontOffice?.email || env.IPC_QUERY_EMAIL,
    mockMailboxEmail: env.IPC_QUERY_EMAIL,

    ipcReplyFrom: { email: env.IPC_ACK_FROM_EMAIL, name: env.IPC_ACK_FROM_NAME },
    inquirer: { email: inquirer.email, name: inquirer.name },

    // Non-secret participant directory: who each role is, nothing more.
    participants: publicDirectory(),
  };
}

/**
 * Send a message on behalf of `asRole`.
 *
 * Attachment refs (`{attachmentId}`) are resolved to real bytes here, before
 * any transport sees the message — see resolveAttachments.js. This is the
 * fail-closed gate: an unknown, missing, or corrupted attachment throws
 * before a single byte is dispatched, for every send path (enquiry, forward,
 * response) alike.
 */
async function sendEmail(
  message,
  { asRole = null, sourceMailbox = null, internalForward = false, onStage = null } = {},
) {
  if (!message?.from) throw Object.assign(new Error('"from" is required'), { status: 400 });

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (recipients.length === 0) {
    throw Object.assign(new Error('at least one recipient is required'), { status: 400 });
  }

  const resolvedAttachments = await resolveAttachments(message.attachments);

  const normalised = { ...message, to: recipients, attachments: resolvedAttachments };
  const transport = await transportFor(sourceMailbox);
  const provider = transport.name || null;
  onStage?.('RESOLUTION', {
    recipient: recipients,
    provider,
    // Both NICeMail transports are held to the test recipient until
    // NIC_ALLOW_OUTBOUND=true; the other providers have no such interlock.
    ...(provider === 'nic-browser' || provider === 'nic'
      ? { guard: outboundAllowed() ? 'production-outbound' : 'test-recipient' }
      : {}),
  });
  const result = await transport.send(normalised, { asRole, internalForward, onStage });

  return {
    ...normalised,
    // Bytes never echo back over HTTP — only metadata leaves this function.
    attachments: resolvedAttachments.map(toPublicRecord),
    ...result,
    sentAt: normalised.timestamp || new Date().toISOString(),
  };
}

/** Inquirer → Front Officer. Sender identity is config, not caller input. */
async function sendEnquiry({ subject, body, attachments = [], cc = [], timestamp }) {
  const inquirer = identityForRole(IDENTITY_ROLES.INQUIRER);
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  return sendEmail(
    {
      from: formatSender(inquirer),
      to: [frontOffice?.email || env.IPC_QUERY_EMAIL],
      cc,
      subject,
      body,
      attachments,
      timestamp,
    },
    { asRole: IDENTITY_ROLES.INQUIRER },
  );
}

/**
 * The acknowledgement exactly as it will be sent — the subject is what the
 * outbox records before sending, so a Sent-folder check can find it later.
 */
function composeAcknowledgement({ to, queryId, sourceMailbox = null }) {
  const frontOffice = senderFor(sourceMailbox);
  return buildAcknowledgement({
    to,
    fromEmail: frontOffice?.email || env.IPC_ACK_FROM_EMAIL,
    fromName: frontOffice?.name || env.IPC_ACK_FROM_NAME,
    queryId,
  });
}

/**
 * `rfcMessageId` is the outbox's id for this attempt; it becomes the Message-ID
 * header on transports that can carry one.
 */
async function sendAcknowledgement({
  to,
  queryId,
  timestamp,
  providerThreadId,
  sourceMailbox = null,
  rfcMessageId = null,
  onStage = null,
}) {
  const message = composeAcknowledgement({ to, queryId, sourceMailbox });

  return sendEmail(
    { ...message, timestamp, providerThreadId, messageIdHeader: rfcMessageId },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE, sourceMailbox, onStage },
  );
}

async function forwardToOfficerInCharge({
  queryId,
  subject,
  body,
  timestamp,
  providerThreadId,
  aiSummary = null,
  attachments = [],
  rfcMessageId = null,
  sourceMailbox = null,
  onStage = null,
}) {
  const frontOffice = senderFor(sourceMailbox);
  const officer = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE);

  if (!officer?.email) {
    throw Object.assign(new Error('No Officer-in-Charge address is configured'), { status: 500 });
  }

  // Fail closed BEFORE the Gemma call: the OIC must never receive a forward
  // that looks complete but is quietly missing a document, and a missing
  // attachment must not still cost an LLM round trip. sendEmail resolves
  // again right before dispatch — cheap, and keeps this check independent of
  // that internal detail rather than relying on it.
  await resolveAttachments(attachments);

  /**
   * A summary the caller already has is used as-is; otherwise one is made here.
   *
   * The generation is wrapped because an AI outage must not cost the forward.
   * It did: `generateSummary` normally degrades to a deterministic stand-in,
   * but when the call itself throws the rejection propagated out of here, the
   * forward failed, and the Officer-in-Charge was never told about an enquiry
   * that had been accepted — an AI blurb taking down the delivery of the thing
   * it was decorating. The covering note goes without it instead.
   */
  let summary = aiSummary;
  if (!summary) {
    // This summary is generated inline rather than through POST /ai/summary,
    // so it has to be audited here or it would be the one AI call the agent
    // makes that never appears in the trail.
    const startedAt = Date.now();
    let error = null;

    try {
      summary = await gemmaService.generateSummary({ subject, body });
    } catch (caught) {
      error = caught.message;
      summary = null;
    }

    await audit.record({
      action: AUDIT_ACTIONS.AI_SUMMARY_GENERATED,
      actorType: ACTOR_TYPES.AGENT,
      queryId,
      result: error ? AUDIT_RESULTS.FAILURE : AUDIT_RESULTS.SUCCESS,
      error,
      aiMetadata: {
        latencyMs: Date.now() - startedAt,
        fallback: Boolean(summary?.fallback),
        aiGenerated: Boolean(summary) && !summary.fallback,
        trigger: 'forward',
      },
    });
  }

  // No summary at all is a legitimate outcome now, so the block is omitted
  // rather than rendered with holes in it.
  const formattedSummaryBlock = summary
    ? [
        '======================================================================',
        '🤖 PRAVAH AI QUERY SUMMARY (For Officer-in-Charge Review):',
        summary.text,
        summary.keyPoints?.length
          ? `Key Points:\n${summary.keyPoints.map((p) => ` • ${p}`).join('\n')}`
          : '',
        summary.topics?.length ? `Topics: ${summary.topics.join(', ')}` : '',
        '======================================================================',
        '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const fullBody = `${formattedSummaryBlock}\n${body || ''}`;

  const sent = await sendEmail(
    {
      from: formatSender(frontOffice),
      to: [officer.email],
      subject: forwardSubject({ subject, queryId }),
      body: fullBody,
      attachments,
      timestamp,
      providerThreadId,
      messageIdHeader: rfcMessageId,
    },
    // `internalForward` is a boolean, never an address: the outbound guard
    // re-derives the Officer-in-Charge's address from config, so nothing a
    // caller supplies can widen what the interlock permits.
    { asRole: IDENTITY_ROLES.FRONT_OFFICE, sourceMailbox, internalForward: true, onStage },
  );

  return { ...sent, aiSummary: summary };
}

/** The forward's subject, known before sending — see `composeAcknowledgement`. */
function forwardSubject({ subject, queryId }) {
  return `Fwd: ${subject} [${queryId}]`;
}

async function sendResponse({
  to,
  subject,
  body,
  attachments = [],
  cc = [],
  timestamp,
  providerThreadId,
  sourceMailbox = null,
  rfcMessageId = null,
  onStage = null,
}) {
  const frontOffice = senderFor(sourceMailbox);

  return sendEmail(
    {
      from: formatSender(frontOffice),
      to: [to],
      cc,
      subject,
      body,
      attachments,
      timestamp,
      providerThreadId,
      messageIdHeader: rfcMessageId,
    },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE, sourceMailbox, onStage },
  );
}

/**
 * Ask the transport a case's mail went through whether an UNCERTAIN send
 * actually left. Gmail can answer from its Sent folder; the mock and both
 * NICeMail paths cannot, and say UNKNOWN — a person settles those.
 */
async function reconcileDelivery(dispatch, { sourceMailbox = null } = {}) {
  const transport = await transportFor(sourceMailbox, IDENTITY_ROLES.FRONT_OFFICE);
  if (typeof transport.reconcile !== 'function') return { verdict: 'UNKNOWN' };
  return transport.reconcile(dispatch, { asRole: IDENTITY_ROLES.FRONT_OFFICE });
}

/** The domain of the address a case's external mail is sent from. */
function senderDomainFor(sourceMailbox) {
  return String(senderFor(sourceMailbox)?.email || '').split('@')[1] || null;
}

// `mailbox` used to be re-exported here, bound directly to mockIpcMailbox —
// which bypassed the gmail/nic/mongo/memory selection in mailbox/index.js. No
// caller used it, so it was a trap rather than a bug. Import
// `services/email/mailbox/index.js` for the active store, as
// controllers/mailboxController.js does.
export {
  getEmailConfig,
  getTransport,
  sendEmail,
  sendEnquiry,
  composeAcknowledgement,
  sendAcknowledgement,
  forwardSubject,
  forwardToOfficerInCharge,
  sendResponse,
  senderFor,
  senderDomainFor,
  reconcileDelivery,
};
