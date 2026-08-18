import { axiosClient } from './axiosClient';

export async function fetchEmailConfig() {
  const { data } = await axiosClient.get('/emails/config');
  return data;
}

export async function fetchMailboxMessages({ recipient, unreadOnly = true } = {}) {
  const { data } = await axiosClient.get('/mailbox/messages', {
    params: { ...(recipient ? { recipient } : {}), unreadOnly: String(unreadOnly) },
  });
  return data;
}

export async function markMessageIngested(mailboxMessageId, { recipient } = {}) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/ingested`,
    {},
    { params: recipient ? { recipient } : {} },
  );
  return data;
}

export async function sendEnquiry({ subject, body, attachments = [], cc = [] }) {
  const { data } = await axiosClient.post('/emails/enquiry', { subject, body, attachments, cc });
  return data;
}

export async function sendAcknowledgement({ to, queryId }) {
  const { data } = await axiosClient.post('/emails/acknowledgement', { to, queryId });
  return data;
}

export async function sendResponse({ to, subject, body, attachments = [], cc = [], providerThreadId }) {
  const { data } = await axiosClient.post('/emails/response', {
    to,
    subject,
    body,
    attachments,
    cc,
    providerThreadId,
  });
  return data;
}

export async function forwardQuery({ queryId, subject, body, providerThreadId }) {
  const { data } = await axiosClient.post('/emails/forward', {
    queryId,
    subject,
    body,
    providerThreadId,
  });
  return data;
}
