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

/**
 * Email orchestration.
 *
 * Sender identity comes from the acting stakeholder, never from the caller and
 * never from one global address: the enquiry is sent by the inquirer, the
 * acknowledgement, forward and final response by the Front Officer. Each is a
 * different Gmail account, so each needs its own credentials.
 */

/**
 * Resolve the transport **for a specific sender**.
 *
 * A role that has its own refresh token sends through Gmail as itself. A role
 * without one falls back to the mock transport rather than borrowing another
 * account's credentials — which would make the QMS claim a `From` address that
 * Gmail did not actually send from. This is what lets the mocked tail of the
 * workflow keep running while the first three stakeholders are real.
 *
 * The Gmail module is loaded with a dynamic import so `googleapis` is never
 * evaluated unless a real send is actually happening.
 */
async function getTransport(name = env.EMAIL_TRANSPORT, asRole = null, asEmail = null) {
  if (name !== EMAIL_TRANSPORTS.GMAIL) return mockTransport;

  // The acting user's ADDRESS is the authority, because a role can hold more
  // than one person — ASSIGNED_OFFICIAL covers a real account and a mock one.
  // Falling back to the role is safe only for the single-holder roles.
  const identity = asEmail ? identityForEmail(asEmail) : asRole ? identityForRole(asRole) : null;
  if ((asEmail || asRole) && !identity?.canSendReal) return mockTransport;

  return import('./transports/gmailTransport.js');
}

function getEmailConfig() {
  const inquirer = identityForRole(IDENTITY_ROLES.INQUIRER);
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);

  return {
    transport: env.EMAIL_TRANSPORT,

    // Where an enquiry is addressed. With real stakeholders this is the Front
    // Officer; IPC_QUERY_EMAIL remains the shared mock mailbox address.
    ipcQueryEmail: frontOffice?.email || env.IPC_QUERY_EMAIL,
    mockMailboxEmail: env.IPC_QUERY_EMAIL,

    ipcReplyFrom: { email: env.IPC_ACK_FROM_EMAIL, name: env.IPC_ACK_FROM_NAME },
    inquirer: { email: inquirer.email, name: inquirer.name },

    // Non-secret participant directory. Never contains tokens — only whether a
    // role is able to authenticate as itself.
    participants: publicDirectory(),
  };
}

/** Send a message on behalf of `asRole`. */
async function sendEmail(message, { asRole = null, asEmail = null } = {}) {
  if (!message?.from) throw Object.assign(new Error('"from" is required'), { status: 400 });

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (recipients.length === 0) {
    throw Object.assign(new Error('at least one recipient is required'), { status: 400 });
  }

  const normalised = { ...message, to: recipients };
  const transport = await getTransport(env.EMAIL_TRANSPORT, asRole, asEmail);
  // The Gmail client is keyed by role; when an address was supplied, use the
  // role that address actually belongs to rather than the one assumed.
  const resolvedRole = asEmail ? identityForEmail(asEmail)?.role || asRole : asRole;
  const result = await transport.send(normalised, { asRole: resolvedRole });

  return { ...normalised, ...result, sentAt: normalised.timestamp || new Date().toISOString() };
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

async function forwardToOfficerInCharge({ queryId, subject, body, timestamp, providerThreadId }) {
  const frontOffice = identityForRole(IDENTITY_ROLES.FRONT_OFFICE);
  const officer = identityForRole(IDENTITY_ROLES.OFFICER_IN_CHARGE);

  if (!officer?.email) {
    throw Object.assign(new Error('No Officer-in-Charge address is configured'), { status: 500 });
  }

  return sendEmail(
    {
      from: formatSender(frontOffice),
      to: [officer.email],
      subject: `Fwd: ${subject} [${queryId}]`,
      body,
      timestamp,
      providerThreadId,
    },
    { asRole: IDENTITY_ROLES.FRONT_OFFICE },
  );
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
