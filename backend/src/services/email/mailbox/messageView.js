import env from '../../../config/env.js';
import { isConnected } from '../../../config/db.js';
import { QueryCase } from '../../../models/QueryCase.js';
import { DECISIONS, findDecisions } from './decisions.js';
import { findTriages } from './triage.js';

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

export const MAIL_STATUS = Object.freeze({
  NEW: 'NEW',
  READ: 'READ',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  /** The machine's verdict, not a person's. Any human decision outranks it. */
  JUNK: 'JUNK',
});

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

/**
 * Precedence: ACCEPTED > REJECTED > JUNK > READ > NEW. A person's decision
 * always beats the machine's verdict, and a rescued message is GENUINE, so it
 * falls through to READ/NEW exactly as it did before it was ever classified.
 */
export function deriveStatus({ isRead, decision, linkedCase, triage }) {
  if (linkedCase || decision?.decision === DECISIONS.ACCEPTED) return MAIL_STATUS.ACCEPTED;
  if (decision?.decision === DECISIONS.REJECTED) return MAIL_STATUS.REJECTED;
  if (triage?.verdict === 'JUNK' && !triage?.rescuedAt) return MAIL_STATUS.JUNK;
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
  let triages = new Map();
  if (ids.length && isConnected()) {
    [decisions, cases, triages] = await Promise.all([findDecisions(ids), casesFor(ids), findTriages(ids)]);
  }

  return messages.map((message) => {
    const decision = decisions.get(message.mailboxMessageId) || null;
    const found = cases.get(message.mailboxMessageId);
    const queryId = found?.queryId || decision?.queryId || null;
    const linkedCase = queryId
      ? { queryId, workflowState: found?.workflowState ?? null, businessStatus: found?.businessStatus ?? null }
      : null;
    const isRead = keepsReadState ? Boolean(message.readAt) : null;

    const triageRow = triages.get(message.mailboxMessageId) || null;
    // A message with no triage row — every row written before this feature
    // existed — gets `triage: null` and keeps exactly the status it had. That
    // is the backward-compatibility contract.
    const triage = triageRow
      ? {
          verdict: triageRow.verdict,
          confidence: triageRow.confidence,
          reason: triageRow.reason,
          classifier: triageRow.classifier,
          rule: triageRow.rule,
          classifiedAt: triageRow.classifiedAt,
          rescuedAt: triageRow.rescuedAt,
          // What makes the rescue window legible in the inbox: "purges in 12
          // hours", rather than a date the reader has to do arithmetic on.
          purgesAt:
            triageRow.verdict === 'JUNK' && !triageRow.rescuedAt && triageRow.classifiedAt
              ? new Date(Date.parse(triageRow.classifiedAt) + env.MAILBOX_RETENTION_HOURS * 3600000).toISOString()
              : null,
        }
      : null;

    return {
      ...message,
      toAddresses: message.toAddresses?.length ? message.toAddresses : [message.to].flat().filter(Boolean),
      isRead,
      status: deriveStatus({ isRead, decision, linkedCase, triage }),
      linkedCase,
      triage,
      purgedAt: message.purgedAt ?? null,
      createdAt: message.createdAt ?? null,
    };
  });
}
