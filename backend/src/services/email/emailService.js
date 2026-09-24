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

async function getTransport(name = env.EMAIL_TRANSPORT) {
  if (name === EMAIL_TRANSPORTS.NIC) return import('./transports/nicTransport.js');
  return mockTransport;
}

const NIC_BROWSER = 'nic-browser';
const isNicBrowser = (sourceMailbox) => sourceMailbox?.source === NIC_BROWSER;

async function transportFor(sourceMailbox) {
  if (isNicBrowser(sourceMailbox)) return import('./transports/nicBrowserTransport.js');
  return getTransport(env.EMAIL_TRANSPORT);
}

function senderFor(sourceMailbox) {
  if (isNicBrowser(sourceMailbox)) {
    return { email: sourceMailbox.address, name: browserConfig.frontOfficeName };
  }
  return identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
}

function getEmailConfig() {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  return {
    transport: env.EMAIL_TRANSPORT,

    nicBrowserMailbox: browserConfig.mailboxEnabled,
    outboundAllowed: outboundAllowed(),

    ipcQueryEmail: frontOffice?.email,

    participants: publicDirectory(),
  };
}

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
    ...(provider === 'nic-browser' || provider === 'nic'
      ? { guard: outboundAllowed() ? 'production-outbound' : 'test-recipient' }
      : {}),
  });
  const result = await transport.send(normalised, { asRole, internalForward, onStage });

  return {
    ...normalised,
    attachments: resolvedAttachments.map(toPublicRecord),
    ...result,
    sentAt: normalised.timestamp || new Date().toISOString(),
  };
}

function composeAcknowledgement({ to, queryId, sourceMailbox = null }) {
  const frontOffice = senderFor(sourceMailbox);
  return buildAcknowledgement({
    to,
    fromEmail: frontOffice?.email,
    fromName: frontOffice?.name,
    queryId,
  });
}

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

  await resolveAttachments(attachments);

  let summary = aiSummary;
  if (!summary) {
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
    { asRole: IDENTITY_ROLES.FRONT_OFFICE, sourceMailbox, internalForward: true, onStage },
  );

  return { ...sent, aiSummary: summary };
}

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

async function reconcileDelivery(dispatch, { sourceMailbox = null } = {}) {
  const transport = await transportFor(sourceMailbox, IDENTITY_ROLES.FRONT_OFFICE);
  if (typeof transport.reconcile !== 'function') return { verdict: 'UNKNOWN' };
  return transport.reconcile(dispatch, { asRole: IDENTITY_ROLES.FRONT_OFFICE });
}

function senderDomainFor(sourceMailbox) {
  return String(senderFor(sourceMailbox)?.email || '').split('@')[1] || null;
}

export {
  getEmailConfig,
  getTransport,
  sendEmail,
  composeAcknowledgement,
  sendAcknowledgement,
  forwardSubject,
  forwardToOfficerInCharge,
  sendResponse,
  senderFor,
  senderDomainFor,
  reconcileDelivery,
};
