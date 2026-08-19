import env, { EMAIL_TRANSPORTS } from '../../config/env.js';
import {
  IDENTITY_ROLES,
  identityForRole,
  identityForEmail,
  formatSender,
  publicDirectory,
} from '../../config/identities.js';
import * as mockTransport from './transports/mockTransport.js';
import * as mailbox from './mailbox/mockIpcMailbox.js';
import { buildAcknowledgement } from './templates/acknowledgement.js';
import * as gemmaService from '../ai/gemmaService.js';

async function getTransport(name = env.EMAIL_TRANSPORT, asRole = null, asEmail = null) {
  if (name !== EMAIL_TRANSPORTS.GMAIL) return mockTransport;
  const identity = asEmail ? identityForEmail(asEmail) : asRole ? identityForRole(asRole) : null;
  if ((asEmail || asRole) && !identity?.canSendReal) return mockTransport;

  return import('./transports/gmailTransport.js');
}

function getEmailConfig() {
  const inquirer = identityForRole(IDENTITY_ROLES.INQUIRER);
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  return {
    transport: env.EMAIL_TRANSPORT,
    ipcQueryEmail: frontOffice?.email || env.IPC_QUERY_EMAIL,
    mockMailboxEmail: env.IPC_QUERY_EMAIL,

    ipcReplyFrom: { email: env.IPC_ACK_FROM_EMAIL, name: env.IPC_ACK_FROM_NAME },
    inquirer: { email: inquirer.email, name: inquirer.name },
    participants: publicDirectory(),
  };
}

async function sendEmail(message, { asRole = null, asEmail = null } = {}) {
  if (!message?.from) throw Object.assign(new Error('"from" is required'), { status: 400 });

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (recipients.length === 0) {
    throw Object.assign(new Error('at least one recipient is required'), { status: 400 });
  }

  const normalised = { ...message, to: recipients };
  const transport = await getTransport(env.EMAIL_TRANSPORT, asRole, asEmail);
  const resolvedRole = asEmail ? identityForEmail(asEmail)?.role || asRole : asRole;
  const result = await transport.send(normalised, { asRole: resolvedRole });

  return { ...normalised, ...result, sentAt: normalised.timestamp || new Date().toISOString() };
}

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

async function sendAcknowledgement({ to, queryId, timestamp, providerThreadId }) {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  const message = buildAcknowledgement({
    to,
    fromEmail: frontOffice?.email || env.IPC_ACK_FROM_EMAIL,
    fromName: frontOffice?.name || env.IPC_ACK_FROM_NAME,
    queryId,
  });

  return sendEmail(
    { ...message, timestamp, providerThreadId },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE },
  );
}

async function forwardToOfficerInCharge({ queryId, subject, body, timestamp, providerThreadId, aiSummary = null }) {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
  const officer = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE);

  if (!officer?.email) {
    throw Object.assign(new Error('No Officer-in-Charge address is configured'), { status: 500 });
  }

  let summary = aiSummary;
  if (!summary) {
    summary = await gemmaService.generateSummary({ subject, body });
  }

  const formattedSummaryBlock = [
    '======================================================================',
    '🤖 GEMMA AI QUERY SUMMARY (For Officer-in-Charge Review):',
    summary.text,
    summary.keyPoints?.length ? `Key Points:\n${summary.keyPoints.map((p) => ` • ${p}`).join('\n')}` : '',
    summary.topics?.length ? `Topics: ${summary.topics.join(', ')}` : '',
    '======================================================================',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const fullBody = `${formattedSummaryBlock}\n${body || ''}`;

  const sent = await sendEmail(
    {
      from: formatSender(frontOffice),
      to: [officer.email],
      subject: `Fwd: ${subject} [${queryId}]`,
      body: fullBody,
      timestamp,
      providerThreadId,
    },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE },
  );

  return { ...sent, aiSummary: summary };
}

async function sendResponse({ to, subject, body, attachments = [], cc = [], timestamp, providerThreadId }) {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

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
    },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE },
  );
}

export {
  getEmailConfig,
  getTransport,
  sendEmail,
  sendEnquiry,
  sendAcknowledgement,
  forwardToOfficerInCharge,
  sendResponse,
  mailbox,
};
