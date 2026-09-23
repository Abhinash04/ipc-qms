import { isConnected } from '../../../config/db.js';
import { QueryCase } from '../../../models/QueryCase.js';
import { DECISIONS, findDecisions } from './decisions.js';

export const MAIL_STATUS = Object.freeze({ NEW: 'NEW', READ: 'READ', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' });

const SEARCHED = ['from', 'subject', 'body'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchFilter(q) {
  if (!q) return {};
  const pattern = escapeRegExp(q);
  return { $or: SEARCHED.map((field) => ({ [field]: { $regex: pattern, $options: 'i' } })) };
}

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
