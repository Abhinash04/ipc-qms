import { google } from 'googleapis';
import env from '../../../config/env.js';
import { identityForRole, IDENTITY_ROLES } from '../../../config/identities.js';

const clients = new Map();

export function getGmailClient(role = IDENTITY_ROLES.INQUIRER) {
  if (clients.has(role)) return clients.get(role);

  const identity = identityForRole(role);
  if (!identity) {
    throw new Error(`Gmail transport: no identity is configured for role "${role}"`);
  }

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) {
    throw new Error(
      'Gmail transport selected but the OAuth app is not configured. ' +
        'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or use EMAIL_TRANSPORT=mock.',
    );
  }

  if (!identity.refreshToken) {
    throw new Error(
      `Cannot send as ${identity.name} <${identity.email}> — ` +
        `GMAIL_REFRESH_TOKEN_${role} is not set. Each account must authorise itself; ` +
        'another stakeholder\'s token must never be used to send on their behalf.',
    );
  }

  const auth = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: identity.refreshToken });

  const client = google.gmail({ version: 'v1', auth });
  clients.set(role, client);
  return client;
}

export async function authenticatedAddress(role) {
  const gmail = getGmailClient(role);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

const asList = (value) => (Array.isArray(value) ? value.join(', ') : value || '');

export function buildRawMessage(message) {
  const headers = [
    `From: ${message.from}`,
    `To: ${asList(message.to)}`,
    message.cc?.length ? `Cc: ${asList(message.cc)}` : null,
    message.bcc?.length ? `Bcc: ${asList(message.bcc)}` : null,
    `Subject: ${message.subject || '(no subject)'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean);

  const raw = `${headers.join('\r\n')}\r\n\r\n${message.body || ''}`;

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function send(message, { asRole = IDENTITY_ROLES.INQUIRER } = {}) {
  const gmail = getGmailClient(asRole);

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildRawMessage(message),
      ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
    },
  });

  return {
    providerMessageId: res.data.id,
    providerThreadId: res.data.threadId,
    transport: 'gmail',
    sentAsRole: asRole,
  };
}

export function reset() {
  clients.clear();
}

export const name = 'gmail';
