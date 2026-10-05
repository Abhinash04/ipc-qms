import { createHmac, createHash } from 'crypto';
import env from '../../config/env.js';

/**
 * Tamper-evident audit chain.
 *
 * Every persisted audit event carries `seq` (1, 2, 3 … with no gaps),
 * `prevHash` (the hash of event seq-1, or GENESIS for seq 1) and `hash`:
 *
 *   hash = HMAC-SHA256(AUDIT_HMAC_SECRET, canonicalJSON(event fields + seq + prevHash))
 *
 * Editing a row breaks its own hash, deleting one leaves a seq gap, and
 * reordering or splicing breaks a prevHash link. Because the hash is keyed,
 * someone with write access to the database but not the secret cannot
 * recompute the chain to hide a change.
 */

export const GENESIS_HASH = '0'.repeat(64);

/** The fields a hash covers, in a fixed list so adding a column is a conscious choice. */
export const CHAINED_FIELDS = [
  'seq',
  'prevHash',
  'timestamp',
  'actorType',
  'actorId',
  'actorRole',
  'auditId',
  'action',
  'result',
  'queryId',
  'messageId',
  'threadId',
  'attachmentId',
  'error',
  'aiMetadata',
  'details',
];

/**
 * Covered by the hash only when present. Events recorded before these fields existed lack
 * them, and leaving an absent field out of the payload keeps those events' hashes valid.
 */
export const OPTIONAL_CHAINED_FIELDS = ['actorName', 'source', 'changes'];

/**
 * JSON with object keys sorted at every level and undefined dropped, so the
 * same record always serialises to the same bytes regardless of key order or
 * how MongoDB returned it.
 */
export function canonicalJSON(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJSON(item) ?? 'null').join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

export function chainPayload(record) {
  const picked = {};
  for (const field of CHAINED_FIELDS) picked[field] = record[field] ?? null;
  for (const field of OPTIONAL_CHAINED_FIELDS) {
    if (record[field] !== null && record[field] !== undefined) picked[field] = record[field];
  }
  return canonicalJSON(picked);
}

function secret() {
  const key = env.AUDIT_HMAC_SECRET;
  if (!key) throw new Error('AUDIT_HMAC_SECRET is not set; audit events cannot be chained');
  return key;
}

export function computeHash(record, key = secret()) {
  return createHmac('sha256', key).update(chainPayload(record)).digest('hex');
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Walks chained rows in seq order and reports every break.
 * `rows` must be sorted by seq ascending and contain only chained rows.
 * Returns the running state so large chains can be verified in batches.
 */
export function verifyRows(rows, state = { expectedSeq: 1, prevHash: GENESIS_HASH, checked: 0, breaks: [] }, key = secret()) {
  let { expectedSeq, prevHash, checked } = state;
  const breaks = state.breaks;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      if (row.seq > expectedSeq) {
        breaks.push({
          seq: expectedSeq,
          reason: 'gap',
          detail: `event${row.seq - expectedSeq === 1 ? '' : 's'} #${expectedSeq}${
            row.seq - expectedSeq > 1 ? `–#${row.seq - 1}` : ''
          } missing — deleted`,
        });
      } else {
        breaks.push({ seq: row.seq, reason: 'order', detail: `event #${row.seq} appears out of sequence` });
      }
    } else if (row.prevHash !== prevHash) {
      breaks.push({
        seq: row.seq,
        reason: 'link',
        detail: `event #${row.seq} does not follow #${row.seq - 1} — reordered or spliced`,
      });
    }

    if (computeHash(row, key) !== row.hash) {
      breaks.push({ seq: row.seq, reason: 'hash', detail: `event #${row.seq} was altered after it was recorded` });
    }

    checked += 1;
    expectedSeq = row.seq + 1;
    prevHash = row.hash;
  }

  return { expectedSeq, prevHash, checked, breaks };
}
