import { axiosClient } from './axiosClient';

export async function fetchEmailConfig() {
  const { data } = await axiosClient.get('/emails/config');
  return data;
}

export async function fetchMailboxMessages({ recipient, unreadOnly = true, q, limit, offset } = {}) {
  const { data } = await axiosClient.get('/mailbox/messages', {
    params: {
      ...(recipient ? { recipient } : {}),
      unreadOnly: String(unreadOnly),
      ...(q ? { q } : {}),
      ...(limit ? { limit, offset: offset ?? 0 } : {}),
    },
  });
  return data;
}

export async function fetchMailboxMessage(mailboxMessageId) {
  const { data } = await axiosClient.get(`/mailbox/messages/${encodeURIComponent(mailboxMessageId)}`);
  return data ?? null;
}

export async function markMailboxMessageRead(mailboxMessageId) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/read`,
  );
  return data;
}

export async function syncMailbox() {
  const { data } = await axiosClient.post('/mailbox/sync');
  return data;
}

export function mailboxAttachmentUrl(mailboxMessageId, attachmentId) {
  const base = (axiosClient.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/attachments/${encodeURIComponent(attachmentId)}?download=1`;
}

export async function markMessageIngested(mailboxMessageId, { recipient } = {}) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/ingested`,
    {},
    { params: recipient ? { recipient } : {} },
  );
  return data;
}

export async function recordMailboxDecision(mailboxMessageId, { decision, queryId, reason, message } = {}) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/decision`,
    { decision, queryId, reason, message },
  );
  return data;
}

export async function acceptMailboxMessage(mailboxMessageId, message) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/accept`,
    message,
  );
  return data;
}

export async function fetchMailboxDecisions() {
  const { data } = await axiosClient.get('/mailbox/decisions');
  return data;
}

export async function deleteMailboxMessage(mailboxMessageId, { recipient } = {}) {
  const { data } = await axiosClient.delete(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}`,
    { params: recipient ? { recipient } : {} },
  );
  return data;
}

export async function sendAcknowledgement({ queryId }) {
  const { data } = await axiosClient.post('/emails/acknowledgement', { queryId });
  return data;
}

export async function sendResponse({ queryId }) {
  const { data } = await axiosClient.post('/emails/response', { queryId });
  return data;
}

export async function forwardQuery({ queryId }) {
  try {
    const { data } = await axiosClient.post('/emails/forward', { queryId });
    return data;
  } catch (error) {
    const unavailable = error?.response?.data?.unavailableAttachments;
    if (unavailable?.length) {
      const names = unavailable.map((u) => u.filename || u.attachmentId).join(', ');
      throw new Error(`Missing attachment(s): ${names}`, { cause: error });
    }
    throw error;
  }
}
