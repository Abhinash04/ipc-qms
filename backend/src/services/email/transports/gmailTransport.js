import { google } from 'googleapis';
import env from '../../../config/env.js';

let cachedClient = null;

function getGmailClient() {
  if (cachedClient) return cachedClient;

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error(
      'Gmail transport selected but credentials are missing. ' +
        'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN, or use EMAIL_TRANSPORT=mock.',
    );
  }

  const auth = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REDIRECT_URI);
  auth.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });

  cachedClient = google.gmail({ version: 'v1', auth });
  return cachedClient;
}

const asList = (value) => (Array.isArray(value) ? value.join(', ') : value || '');

function buildRawMessage(message) {
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

async function send(message) {
  const gmail = getGmailClient();

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
  };
}

function reset() {
  cachedClient = null;
}

export const name = 'gmail';
export { send, reset, buildRawMessage };
