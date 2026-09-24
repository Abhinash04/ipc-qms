import env from '../../../config/env.js';
import { isConnected } from '../../../config/db.js';
import { QueryCase } from '../../../models/QueryCase.js';
import { DECISIONS, findDecisions } from './decisions.js';
import { findTriages } from './triage.js';

export const MAIL_STATUS = Object.freeze({
  NEW: 'NEW',
  READ: 'READ',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  JUNK: 'JUNK',
});

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

export function purgesAtFor(row) {
  if (!row || row.rescuedAt || !row.classifiedAt) return null;
  const from = Date.parse(row.classifiedAt);
  if (Number.isNaN(from)) return null;
  const hours =
    row.verdict === 'JUNK' && row.confidence >= env.MAILBOX_JUNK_CONFIDENCE
      ? env.MAILBOX_RETENTION_HOURS
      : env.MAILBOX_UNREGISTERED_RETENTION_HOURS;
  return new Date(from + hours * 3600000).toISOString();
}

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
    const triage = triageRow
      ? {
          verdict: triageRow.verdict,
          confidence: triageRow.confidence,
          reason: triageRow.reason,
          classifier: triageRow.classifier,
          rule: triageRow.rule,
          classifiedAt: triageRow.classifiedAt,
          rescuedAt: triageRow.rescuedAt,
          purgesAt: purgesAtFor(triageRow),
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
