import env, { EMAIL_TRANSPORTS } from '../../config/env.js';
import * as mockTransport from './transports/mockTransport.js';
import * as mailbox from './mailbox/mockIpcMailbox.js';
import { buildAcknowledgement } from './templates/acknowledgement.js';

async function getTransport(name = env.EMAIL_TRANSPORT) {
  if (name === EMAIL_TRANSPORTS.GMAIL) {
    return import('./transports/gmailTransport.js');
  }
  return mockTransport;
}

function getEmailConfig() {
  return {
    transport: env.EMAIL_TRANSPORT,
    ipcQueryEmail: env.IPC_QUERY_EMAIL,
    ipcReplyFrom: { email: env.IPC_ACK_FROM_EMAIL, name: env.IPC_ACK_FROM_NAME },
    inquirer: { email: env.INQUIRER_EMAIL, name: env.INQUIRER_NAME },
  };
}

async function sendEmail(message) {
  if (!message?.from) throw Object.assign(new Error('"from" is required'), { status: 400 });

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (recipients.length === 0) {
    throw Object.assign(new Error('at least one recipient is required'), { status: 400 });
  }

  const normalised = { ...message, to: recipients };
  const transport = await getTransport();
  const result = await transport.send(normalised);

  return { ...normalised, ...result, sentAt: normalised.timestamp || new Date().toISOString() };
}

async function sendEnquiry({ subject, body, attachments = [], cc = [], timestamp }) {
  const config = getEmailConfig();
  const from = config.inquirer.name
    ? `${config.inquirer.name} <${config.inquirer.email}>`
    : config.inquirer.email;

  return sendEmail({
    from,
    to: [config.ipcQueryEmail],
    cc,
    subject,
    body,
    attachments,
    timestamp,
  });
}

async function sendAcknowledgement({ to, queryId, timestamp }) {
  const config = getEmailConfig();
  const message = buildAcknowledgement({
    to,
    fromEmail: config.ipcReplyFrom.email,
    fromName: config.ipcReplyFrom.name,
    queryId,
  });
  return sendEmail({ ...message, timestamp });
}

async function sendResponse({ to, subject, body, attachments = [], cc = [], timestamp, providerThreadId }) {
  const config = getEmailConfig();
  return sendEmail({
    from: `${config.ipcReplyFrom.name} <${config.ipcReplyFrom.email}>`,
    to: [to],
    cc,
    subject,
    body,
    attachments,
    timestamp,
    providerThreadId,
  });
}

export {
  getEmailConfig,
  getTransport,
  sendEmail,
  sendEnquiry,
  sendAcknowledgement,
  sendResponse,
  mailbox,
};
