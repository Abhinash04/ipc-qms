import { AUDIT_EVENT } from './statusEnums';
import { findUserById } from './mockUsers';
import { STAGE_LABELS } from './pullbackRules';
import { ROLE_LABELS } from './roles';

export const SPECIAL_EVENT = Object.freeze({
  PULL_BACK: 'pull_back',
  TRANSFER_QUERY: 'transfer_query',
});

const SAME_TRANSFER_MS = 2 * 60 * 1000;

const person = (name, roleCode) => (name || roleCode ? { name: name || null, role: ROLE_LABELS[roleCode] || roleCode || null } : null);

function userParty(userId) {
  if (!userId) return null;
  const user = findUserById(userId);
  return person(user?.name || userId, user?.role);
}

const stageName = (state, level) => [STAGE_LABELS[state] || state, level].filter(Boolean).join(' · ') || null;

function fromPullback(entry, index) {
  return {
    id: `pullback-${entry.pulledBackAt || index}`,
    type: SPECIAL_EVENT.PULL_BACK,
    at: entry.pulledBackAt || null,
    by: person(entry.pulledBackByName, entry.pulledBackByRole),
    from: { stage: stageName(entry.fromStage), ...(entry.previousAssignee ? { name: entry.previousAssignee } : {}) },
    to: { stage: stageName(entry.toStage, entry.toReviewLevel), ...(entry.newAssignee ? { name: entry.newAssignee } : {}) },
    reason: entry.reason || null,
    remarks: entry.remarks || null,
    automatic: false,
  };
}

function fromTransferRecord(entry, index) {
  const automatic = entry.transferType === 'AUTOMATIC';
  return {
    id: `transfer-${entry.transferredAt || index}`,
    type: SPECIAL_EVENT.TRANSFER_QUERY,
    at: entry.transferredAt || null,
    by: automatic ? { name: 'BRIDGETECH', role: 'Automatic transfer' } : userParty(entry.byUserId),
    from: userParty(entry.fromAssigneeId),
    to: userParty(entry.toAssigneeId),
    reason: entry.reason || null,
    remarks: automatic && Number.isFinite(entry.matchPercent) ? `${entry.matchPercent}% match to the query` : null,
    automatic,
  };
}

function parseTransferDetails(details) {
  if (typeof details !== 'string') return {};
  const field = (label) => details.match(new RegExp(`${label}:\\s*([^|]+)`))?.[1]?.trim() || null;
  return {
    from: field('Transferred From'),
    to: field('Transferred To'),
    by: field('Transferred By'),
    reason: field('Reason'),
  };
}

function fromTransferAudit(entry) {
  const parsed = parseTransferDetails(entry.details);
  const actor = entry.actorId ? findUserById(entry.actorId) : null;
  return {
    id: `transfer-audit-${entry.auditId || entry.at}`,
    type: SPECIAL_EVENT.TRANSFER_QUERY,
    at: entry.at || null,
    by: person(actor?.name || parsed.by, entry.actorRole || actor?.role),
    from: parsed.from ? { name: parsed.from } : null,
    to: parsed.to ? { name: parsed.to } : null,
    reason: parsed.reason,
    remarks: null,
    automatic: false,
  };
}

const near = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= SAME_TRANSFER_MS;

export function buildSpecialEvents({ query, audit = [] } = {}) {
  if (!query) return [];

  const pullbacks = (query.pullbackHistory || []).map(fromPullback);
  const records = (query.transferHistory || []).map(fromTransferRecord);
  const recorded = records.filter((record) => !record.automatic);
  const auditOnly = audit
    .filter((entry) => entry.event === AUDIT_EVENT.QUERY_TRANSFERRED)
    .filter((entry) => !recorded.some((record) => record.at && entry.at && near(record.at, entry.at)))
    .map(fromTransferAudit);

  return [...pullbacks, ...records, ...auditOnly].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
