import { isConnected } from '../../../config/db.js';
import { QueryCase } from '../../../models/QueryCase.js';
import { DECISIONS, findDecisions } from './decisions.js';

/**
 * A stored mailbox message as the API returns it.
 *
 * The stored document is returned as it is — every field today's clients
 * read keeps its name and meaning — with what the dashboard needs worked out
 * on top: the real To list, whether the Front Office has read it, where it
 * stands (NEW / READ / ACCEPTED / REJECTED), and the case it became, with that
 * case's status. The status and the case are derived, never stored: the
 * decision record and the case are the truth, and a stored copy would drift.
 *
 * Must not import nicBrowserMailbox.js, which may only be loaded on demand.
 */

export const MAIL_STATUS = Object.freeze({ NEW: 'NEW', READ: 'READ', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' });

/** Where a search looks. */
const SEARCHED = ['from', 'subject', 'body'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A MongoDB filter for a case-insensitive substring search, or nothing. */
export function searchFilter(q) {
  if (!q) return {};
  const pattern = escapeRegExp(q);
  return { $or: SEARCHED.map((field) => ({ [field]: { $regex: pattern, $options: 'i' } })) };
}

/** The same search, for stores that are not queried in MongoDB. */
export function matchesSearch(message, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return SEARCHED.some((field) => String(message[field] ?? '').toLowerCase().includes(needle));
}

export function deriveStatus({ isRead, decision, linkedCase }) {
  if (linkedCase || decision?.decision === DECISIONS.ACCEPTED) return MAIL_STATUS.ACCEPTED;
  if (decision?.decision === DECISIONS.REJECTED) return MAIL_STATUS.REJECTED;
  return isRead ? MAIL_STATUS.READ : MAIL_STATUS.NEW;
}

async function casesFor(ids) {
  const rows = await QueryCase.find({ sourceMailboxMessageId: { $in: ids } })
    .select('queryId workflowState businessStatus sourceMailboxMessageId')
    .lean();
  return new Map(rows.map((row) => [row.sourceMailboxMessageId, row]));
}

/**
 * The API view of each message, with decisions and cases looked up in one
 * query each for the whole list. `keepsReadState` is false for a mailbox that
 * has no QMS read state (every one but NICeMail's): `isRead` is then null —
 * unknown, not unread.
 */
export async function toMessageViews(messages, { keepsReadState = false } = {}) {
  const ids = messages.map((message) => message.mailboxMessageId).filter(Boolean);
  let decisions = new Map();
  let cases = new Map();
  if (ids.length && isConnected()) {
    [decisions, cases] = await Promise.all([findDecisions(ids), casesFor(ids)]);
  }

  return messages.map((message) => {
    const decision = decisions.get(message.mailboxMessageId) || null;
    const found = cases.get(message.mailboxMessageId);
    const queryId = found?.queryId || decision?.queryId || null;
    const linkedCase = queryId
      ? { queryId, workflowState: found?.workflowState ?? null, businessStatus: found?.businessStatus ?? null }
      : null;
    const isRead = keepsReadState ? Boolean(message.readAt) : null;

    return {
      ...message,
      toAddresses: message.toAddresses?.length ? message.toAddresses : [message.to].flat().filter(Boolean),
      isRead,
      status: deriveStatus({ isRead, decision, linkedCase }),
      linkedCase,
      createdAt: message.createdAt ?? null,
    };
  });
}
