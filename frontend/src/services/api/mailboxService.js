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

/**
 * Record the Front Officer's accept/reject on one incoming message.
 *
 * The server stores the first decision and ignores later ones, answering
 * `alreadyDecided: true` — so a double-click, a retry or a second Front Officer
 * looking at the same inbox cannot produce two cases for one email.
 */
export async function recordMailboxDecision(mailboxMessageId, { decision, queryId, reason, message } = {}) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/decision`,
    { decision, queryId, reason, message },
  );
  return data;
}

/**
 * Accept an incoming message: the whole intake sequence, server-side.
 *
 * One call mints the Case ID, creates the case, acknowledges the sender and
 * forwards to the Officer-in-Charge. It used to be four calls orchestrated by
 * this browser, which meant a closed tab halfway through left a case nobody had
 * been told about. Safe to retry: the server checks each artefact before acting.
 *
 * Resolves to `{ queryId, created, alreadyDecided, acknowledged, forwarded, errors }`
 * — a step that failed is reported, not thrown, because a case that exists but
 * was not forwarded is recoverable and losing its id would not be.
 */
export async function acceptMailboxMessage(mailboxMessageId, message) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/accept`,
    message,
  );
  return data;
}

/**
 * Decisions already taken, so the inbox can show what was accepted or rejected.
 * Needed as a separate read because under MAILBOX_SOURCE=gmail the message is a
 * live view of a real account and carries no QMS state of its own.
 */
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

export async function sendEnquiry({ subject, body, attachments = [], cc = [] }) {
  const { data } = await axiosClient.post('/emails/enquiry', { subject, body, attachments, cc });
  return data;
}

export async function sendAcknowledgement({ to, queryId }) {
  const { data } = await axiosClient.post('/emails/acknowledgement', { to, queryId });
  return data;
}

/**
 * `queryId` is what lets the server answer through the mailbox the case came
 * from. The server reads that mailbox off the stored case — this only names
 * the case — so a NICeMail enquiry is answered from NICeMail, not from the
 * default transport.
 */
export async function sendResponse({ to, subject, body, attachments = [], cc = [], providerThreadId, queryId }) {
  const { data } = await axiosClient.post('/emails/response', {
    to,
    subject,
    body,
    attachments,
    cc,
    providerThreadId,
    ...(queryId ? { queryId } : {}),
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
