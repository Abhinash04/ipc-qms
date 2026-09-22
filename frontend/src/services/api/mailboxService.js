import { axiosClient } from './axiosClient';

export async function fetchEmailConfig() {
  const { data } = await axiosClient.get('/emails/config');
  return data;
}

/**
 * `unreadOnly` means awaiting validation — not yet accepted or rejected — and
 * never "not yet opened", which is each message's `isRead`. `q` searches the
 * sender, subject and body. With `limit` the list is one page and the answer
 * adds `total`; without it the whole list comes back, as it always has.
 */
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

/** One message, with its HTML body. `null`, never undefined, so react-query can cache it. */
export async function fetchMailboxMessage(mailboxMessageId) {
  const { data } = await axiosClient.get(`/mailbox/messages/${encodeURIComponent(mailboxMessageId)}`);
  return data ?? null;
}

/**
 * Read state kept by QMS alone: opening a message here never marks it read in
 * NICeMail. The server answers 409 for a mailbox that keeps no read state.
 */
export async function markMailboxMessageRead(mailboxMessageId) {
  const { data } = await axiosClient.post(
    `/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/read`,
  );
  return data;
}

/** Starts a NICeMail sync in the background; `{ supported: false }` for any other mailbox. */
export async function syncMailbox() {
  const { data } = await axiosClient.post('/mailbox/sync');
  return data;
}

/** Download URL for one attachment, checked by the server against the message it came with. */
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

/**
 * The three case emails — the acknowledgement, the forward, the final response.
 *
 * Each names a case and nothing else. The server reads who is written to and
 * what they are told from the stored case, and sends each at most once: two
 * presses of a retry button, or two officers on the same case, produce one
 * email. The answers are
 * `{ outcome: SENT | ALREADY_SENT | IN_PROGRESS | FAILED | UNCERTAIN | BLOCKED_UNCERTAIN, dispatch }`,
 * and everything but the first two arrives as an HTTP error.
 *
 * They used to carry the recipient and the text from this browser, with no
 * guard anywhere: a retry could address anyone, and a double click sent twice.
 */
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
