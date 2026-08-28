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

export async function deleteMailboxMessage(mailboxMessageId, { recipient } = {}) {
  const { data } = await axiosClient.delete(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}`,
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

export async function forwardQuery({ queryId, subject, body, providerThreadId, attachments = [] }) {
  try {
    const { data } = await axiosClient.post('/emails/forward', {
      queryId,
      subject,
      body,
      providerThreadId,
      attachments,
    });
    return data;
  } catch (error) {
    // The backend fails a forward closed (409) when an attachment cannot be
    // resolved — surface exactly which one, rather than a generic HTTP error,
    // so the Front Officer knows what to fix before retrying.
    const unavailable = error?.response?.data?.unavailableAttachments;
    if (unavailable?.length) {
      const names = unavailable.map((u) => u.filename || u.attachmentId).join(', ');
      throw new Error(`Missing attachment(s): ${names}`, { cause: error });
    }
    throw error;
  }
}
