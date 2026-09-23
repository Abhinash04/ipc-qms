import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The sweep itself, against the in-memory Mongo stand-in.
 *
 * The single most important assertion in this file is that a purged row keeps
 * its `providerMessageId`: the sync builds its skip-set from stored provider
 * ids, so a row that loses one is re-ingested on the next poll, re-classified,
 * and purged again, forever.
 */

vi.mock('../config/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isConnected: () => true,
}));
vi.mock('../models/MailboxMessage.js', async () => {
  const { memoryDb } = await import('./support/memoryDb.js');
  return {
    MailboxMessage: memoryDb.model('MailboxMessage', {
      unique: ['mailboxMessageId'],
      uniqueWhenString: ['providerMessageId'],
    }),
    Counter: memoryDb.model('Counter'),
  };
});
vi.mock('../models/MailboxTriage.js', async () => {
  const actual = await vi.importActual('../models/MailboxTriage.js');
  const { memoryDb } = await import('./support/memoryDb.js');
  return { ...actual, MailboxTriage: memoryDb.model('MailboxTriage', { unique: ['mailboxMessageId'] }) };
});
vi.mock('../models/MailboxDecision.js', async () => {
  const actual = await vi.importActual('../models/MailboxDecision.js');
  const { memoryDb } = await import('./support/memoryDb.js');
  return { ...actual, MailboxDecision: memoryDb.model('MailboxDecision', { unique: ['mailboxMessageId'] }) };
});
vi.mock('../models/QueryCase.js', async () => ({
  QueryCase: (await import('./support/memoryDb.js')).memoryDb.model('QueryCase', { unique: ['queryId'] }),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));
vi.mock('../services/attachments/attachmentStore.js', () => ({
  remove: vi.fn(async () => {}),
}));

import { memoryDb as db } from './support/memoryDb.js';
import { MailboxMessage } from '../models/MailboxMessage.js';
import { MailboxTriage } from '../models/MailboxTriage.js';
import { MailboxDecision } from '../models/MailboxDecision.js';
import { QueryCase } from '../models/QueryCase.js';
import { AuditEvent } from '../models/AuditEvent.js';
import * as attachmentStore from '../services/attachments/attachmentStore.js';
import { sweepOnce } from '../services/email/mailbox/retention.js';
import { isKnownAuditAction } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { resetBuffer } from '../services/audit/auditService.js';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const hoursAgo = (n) => new Date(NOW - n * 3600000).toISOString();

/** A stored NICeMail message, with the weight that makes this feature worth it. */
async function storeMessage(id, overrides = {}) {
  await MailboxMessage.create({
    mailboxMessageId: id,
    providerMessageId: `provider-${id}`,
    providerThreadId: `thread-${id}`,
    source: 'nic-browser',
    to: 'nic@ipc.invalid',
    from: 'Blast <news@marketing.invalid>',
    subject: 'Half price reagents this week',
    body: 'Buy now.',
    bodyHtml: '<p>Buy now.</p>',
    attachments: [],
    receivedAt: hoursAgo(50),
    removedAt: null,
    purgedAt: null,
    readAt: null,
    createdAt: hoursAgo(50),
    ...overrides,
  });
}

async function triage(id, overrides = {}) {
  await MailboxTriage.create({
    mailboxMessageId: id,
    verdict: 'JUNK',
    confidence: 1,
    classifier: 'rules',
    rule: 'loop',
    ruleClass: 'hard',
    reason: 'sent by this system',
    classifiedAt: hoursAgo(50),
    gemmaAt: hoursAgo(50),
    attempts: 0,
    rescuedAt: null,
    purgedAt: null,
    createdAt: hoursAgo(50),
    ...overrides,
  });
}

// `classify: false` throughout: the model phase has its own test file, and
// GEMMA_API_URL is blank in the suite anyway.
const sweep = (options = {}) =>
  sweepOnce({ now: NOW, classify: false, ignoreGrace: true, retentionHours: 46, ...options });

beforeEach(() => {
  db.reset();
  resetBuffer();
  vi.mocked(attachmentStore.remove).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('what the sweep purges', () => {
  it('strips the content of junk older than the window', async () => {
    await storeMessage('NICB-old');
    await triage('NICB-old');

    const result = await sweep();
    expect(result.purged).toBe(1);

    const row = await MailboxMessage.findOne({ mailboxMessageId: 'NICB-old' }).lean();
    expect(row.body).toBe('');
    expect(row.bodyHtml).toBeNull();
    expect(row.attachments).toEqual([]);
    expect(row.purgedAt).toBe('2026-09-23T12:00:00.000Z');
    expect(row.removedAt).toBe('2026-09-23T12:00:00.000Z');
  });

  it('KEEPS the ids the next sync needs, or the message comes straight back', async () => {
    await storeMessage('NICB-old');
    await triage('NICB-old');
    await sweep();

    const row = await MailboxMessage.findOne({ mailboxMessageId: 'NICB-old' }).lean();
    // nicBrowserMailbox builds its skip-set from stored providerMessageIds.
    // Lose this and the message is re-ingested, re-classified and re-purged on
    // every poll for as long as it sits in the provider's inbox.
    expect(row.providerMessageId).toBe('provider-NICB-old');
    expect(row.mailboxMessageId).toBe('NICB-old');
    expect(row.source).toBe('nic-browser');
  });

  it('keeps enough to answer "what was thrown away, and who sent it?"', async () => {
    await storeMessage('NICB-old');
    await triage('NICB-old');
    await sweep();

    const row = await MailboxMessage.findOne({ mailboxMessageId: 'NICB-old' }).lean();
    expect(row.from).toBe('Blast <news@marketing.invalid>');
    expect(row.subject).toBe('Half price reagents this week');
    expect(row.receivedAt).toBeTruthy();
  });

  it('leaves junk that is not old enough alone', async () => {
    await storeMessage('NICB-fresh');
    await triage('NICB-fresh', { classifiedAt: hoursAgo(45) });

    expect((await sweep()).purged).toBe(0);
    expect((await MailboxMessage.findOne({ mailboxMessageId: 'NICB-fresh' }).lean()).body).toBe('Buy now.');
  });

  it('purges a message a person rejected, with no triage row at all', async () => {
    await storeMessage('NICB-rejected');
    await MailboxDecision.create({
      mailboxMessageId: 'NICB-rejected',
      decision: 'REJECTED',
      decidedAt: hoursAgo(50),
      decidedByUserId: 'USR-0001',
    });

    expect((await sweep()).purged).toBe(1);
  });

  it('purges a message somebody read — reading is not rescuing', async () => {
    await storeMessage('NICB-read', { readAt: hoursAgo(49), readByUserId: 'USR-0001' });
    await triage('NICB-read');

    expect((await sweep()).purged).toBe(1);
  });

  it('purges a message a person deleted, which still carries its whole body', async () => {
    await storeMessage('NICB-deleted', { removedAt: hoursAgo(48) });
    await triage('NICB-deleted');

    expect((await sweep()).purged).toBe(1);
    const row = await MailboxMessage.findOne({ mailboxMessageId: 'NICB-deleted' }).lean();
    // The person's own deletion time survives; only purgedAt is new.
    expect(row.removedAt).toBe(hoursAgo(48));
    expect(row.purgedAt).toBe('2026-09-23T12:00:00.000Z');
  });
});

describe('what the sweep refuses to touch', () => {
  it('spares a message somebody accepted', async () => {
    await storeMessage('NICB-accepted');
    await triage('NICB-accepted');
    await MailboxDecision.create({
      mailboxMessageId: 'NICB-accepted',
      decision: 'ACCEPTED',
      decidedAt: hoursAgo(48),
      decidedByUserId: 'USR-0001',
    });

    const result = await sweep();
    expect(result.purged).toBe(0);
    expect(result.skipped.accepted).toBe(1);
  });

  it('spares a message that became a case', async () => {
    await storeMessage('NICB-case');
    await triage('NICB-case');
    await QueryCase.create({ queryId: 'QRY-2026-00001', sourceMailboxMessageId: 'NICB-case' });

    const result = await sweep();
    expect(result.purged).toBe(0);
    expect(result.skipped.linkedCase).toBe(1);
  });

  it('spares a message a person rescued', async () => {
    await storeMessage('NICB-rescued');
    await triage('NICB-rescued', { rescuedAt: hoursAgo(20), verdict: 'GENUINE', confidence: 0 });

    expect((await sweep()).purged).toBe(0);
  });

  it('spares a message whose verdict is not confident enough', async () => {
    await storeMessage('NICB-unsure');
    await triage('NICB-unsure', { confidence: 0.5, classifier: 'gemma', ruleClass: 'soft' });

    expect((await sweep()).purged).toBe(0);
  });

  it('spares a source that is not purgeable', async () => {
    await storeMessage('LOCAL-1', { source: 'local' });
    await triage('LOCAL-1');

    const result = await sweep();
    expect(result.purged).toBe(0);
    expect(result.skipped.notPurgeableSource).toBe(1);
  });
});

describe('attachments', () => {
  const ATT = 'a'.repeat(32);

  it('removes the bytes from disk, which nothing else in this system does', async () => {
    await storeMessage('NICB-att', { attachments: [{ attachmentId: ATT, filename: 'flyer.pdf' }] });
    await triage('NICB-att');

    const result = await sweep();
    expect(attachmentStore.remove).toHaveBeenCalledWith(ATT);
    expect(result.attachmentsRemoved).toBe(1);
  });

  it('carries on when one attachment cannot be removed', async () => {
    // assertValidId throws on a malformed legacy id, and one bad row must not
    // stop the sweep.
    vi.mocked(attachmentStore.remove).mockRejectedValueOnce(new Error('not a valid attachment id'));
    await storeMessage('NICB-bad', { attachments: [{ attachmentId: 'nope' }] });
    await triage('NICB-bad');

    expect((await sweep()).purged).toBe(1);
  });
});

describe('the sweep as a job', () => {
  it('changes nothing on a dry run, but reports the same counts', async () => {
    await storeMessage('NICB-dry', { attachments: [{ attachmentId: 'b'.repeat(32) }] });
    await triage('NICB-dry');

    const result = await sweep({ dryRun: true });
    expect(result.purged).toBe(1);
    expect(result.attachmentsRemoved).toBe(1);
    expect(attachmentStore.remove).not.toHaveBeenCalled();
    expect((await MailboxMessage.findOne({ mailboxMessageId: 'NICB-dry' }).lean()).body).toBe('Buy now.');
  });

  it('is idempotent — a second pass finds nothing', async () => {
    await storeMessage('NICB-twice');
    await triage('NICB-twice');

    expect((await sweep()).purged).toBe(1);
    expect((await sweep()).purged).toBe(0);
  });

  it('purges no more than one batch at a time', async () => {
    for (let i = 0; i < 120; i += 1) {
      await storeMessage(`NICB-${i}`);
      await triage(`NICB-${i}`);
    }
    expect((await sweep({ limit: 50 })).purged).toBe(50);
  });

  it('purges nothing in the grace period after boot', async () => {
    // The retention window is wall-clock, but the rescue window only exists
    // while somebody can see the inbox. A server back from a two-day outage
    // must not purge its backlog before anyone has had a live look at it.
    await storeMessage('NICB-boot');
    await triage('NICB-boot');

    const result = await sweepOnce({ now: NOW, classify: false, retentionHours: 46 });
    expect(result.grace).toBe(true);
    expect(result.purged).toBe(0);
  });
});

describe('the audit trail', () => {
  it('records every purge with the sender and subject it destroyed', async () => {
    await storeMessage('NICB-audited');
    await triage('NICB-audited');
    await sweep();

    const rows = await AuditEvent.find({ action: 'EMAIL_PURGED' }).lean();
    const one = rows.find((row) => row.messageId === 'NICB-audited');
    expect(one.actorType).toBe(ACTOR_TYPES.SYSTEM);
    expect(one.details.from).toBe('Blast <news@marketing.invalid>');
    expect(one.details.subject).toBe('Half price reagents this week');
    expect(one.details.reason).toBe('machine-junk');
    expect(one.details.rule).toBe('loop');
  });

  it('uses an action the audit API will accept', async () => {
    expect(isKnownAuditAction('EMAIL_PURGED')).toBe(true);
  });

  it('writes nothing at all for a sweep that purged nothing', async () => {
    await sweep();
    expect(await AuditEvent.countDocuments({ action: 'EMAIL_PURGED' })).toBe(0);
  });
});
