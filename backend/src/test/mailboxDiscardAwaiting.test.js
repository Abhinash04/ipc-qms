import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import {
  AWAITING_DISCARD_REASON,
  discardAwaiting,
  findAwaiting,
  sweepOnce,
} from '../services/email/mailbox/retention.js';
import { resetBuffer } from '../services/audit/auditService.js';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const hoursAgo = (n) => new Date(NOW - n * 3600000).toISOString();

async function storeMessage(id, overrides = {}) {
  await MailboxMessage.create({
    mailboxMessageId: id,
    providerMessageId: `provider-${id}`,
    providerThreadId: `thread-${id}`,
    source: 'nic-browser',
    to: 'nic@ipc.invalid',
    from: 'Inquirer <someone@example.invalid>',
    subject: `Subject of ${id}`,
    body: 'Please advise on the monograph.',
    bodyHtml: '<p>Please advise on the monograph.</p>',
    attachments: [],
    aiSummary: 'summary',
    receivedAt: hoursAgo(5),
    removedAt: null,
    purgedAt: null,
    readAt: null,
    ingested: false,
    createdAt: hoursAgo(5),
    ...overrides,
  });
}

async function triage(id, overrides = {}) {
  await MailboxTriage.create({
    mailboxMessageId: id,
    verdict: 'GENUINE',
    confidence: 0,
    classifier: 'rules',
    rule: null,
    ruleClass: 'none',
    reason: '',
    classifiedAt: hoursAgo(5),
    attempts: 0,
    rescuedAt: null,
    purgedAt: null,
    createdAt: hoursAgo(5),
    ...overrides,
  });
}

const decide = (id, decision) =>
  MailboxDecision.create({ mailboxMessageId: id, decision, decidedAt: hoursAgo(1) });

const row = (id) => MailboxMessage.findOne({ mailboxMessageId: id }).lean();

async function seedEveryState() {
  await storeMessage('NICB-new');
  await triage('NICB-new');
  await storeMessage('NICB-read', {
    readAt: hoursAgo(2),
    attachments: [{ attachmentId: 'ATT-1', filename: 'letter.pdf' }],
  });
  await storeMessage('NICB-untriaged');
  await storeMessage('NICB-rescued');
  await triage('NICB-rescued', { verdict: 'JUNK', confidence: 1, rescuedAt: hoursAgo(1), classifier: 'human' });

  await storeMessage('NICB-accepted');
  await decide('NICB-accepted', 'ACCEPTED');
  await storeMessage('NICB-rejected');
  await decide('NICB-rejected', 'REJECTED');
  await storeMessage('NICB-registered');
  await QueryCase.create({ queryId: 'QRY-2026-00001', sourceMailboxMessageId: 'NICB-registered' });
  await storeMessage('NICB-junk');
  await triage('NICB-junk', { verdict: 'JUNK', confidence: 1 });
  await storeMessage('NICB-unsure-junk');
  await triage('NICB-unsure-junk', { verdict: 'JUNK', confidence: 0.4 });
  await storeMessage('NICB-purged', { purgedAt: hoursAgo(3), removedAt: hoursAgo(3), body: '' });
  await storeMessage('NICB-removed', { removedAt: hoursAgo(3) });
  await storeMessage('MOCK-other-source', { source: 'mongo', providerMessageId: null });
}

const AWAITING = ['NICB-new', 'NICB-read', 'NICB-rescued', 'NICB-untriaged'];

beforeEach(() => {
  db.reset();
  resetBuffer();
  vi.mocked(attachmentStore.remove).mockClear();
});

describe('which messages count as awaiting validation', () => {
  it('finds exactly the undecided, unregistered, non-junk mail still in the inbox', async () => {
    await seedEveryState();

    const found = await findAwaiting();

    expect(found.map((message) => message.mailboxMessageId).sort()).toEqual([...AWAITING].sort());
  });
});

describe('discarding awaiting mail', () => {
  it('purges every awaiting message and nothing else', async () => {
    await seedEveryState();

    const result = await discardAwaiting({ now: NOW });

    expect(result.errors).toEqual([]);
    expect(result.scanned).toBe(4);
    expect(result.discarded).toBe(4);
    for (const id of AWAITING) {
      const stored = await row(id);
      expect(stored.body).toBe('');
      expect(stored.bodyHtml).toBeNull();
      expect(stored.attachments).toEqual([]);
      expect(stored.aiSummary).toBeNull();
      expect(stored.purgedAt).toBe('2026-09-28T12:00:00.000Z');
      expect(stored.removedAt).toBe('2026-09-28T12:00:00.000Z');
    }
    for (const id of ['NICB-accepted', 'NICB-rejected', 'NICB-registered', 'NICB-junk', 'NICB-unsure-junk', 'NICB-removed']) {
      const stored = await row(id);
      expect(stored.body).toBe('Please advise on the monograph.');
      expect(stored.purgedAt).toBeNull();
    }
    expect((await row('MOCK-other-source')).purgedAt).toBeNull();
    expect((await row('NICB-purged')).purgedAt).toBe(hoursAgo(3));
  });

  it('keeps the provider id stub so the next sync cannot bring the message back', async () => {
    await storeMessage('NICB-new');

    await discardAwaiting({ now: NOW });

    const stored = await row('NICB-new');
    expect(stored.providerMessageId).toBe('provider-NICB-new');
    expect(stored.from).toBe('Inquirer <someone@example.invalid>');
    expect(stored.subject).toBe('Subject of NICB-new');
  });

  it('deletes the attachment files and marks the triage row purged', async () => {
    await seedEveryState();

    const result = await discardAwaiting({ now: NOW });

    expect(result.attachmentsRemoved).toBe(1);
    expect(attachmentStore.remove).toHaveBeenCalledWith('ATT-1');
    const triageRow = await MailboxTriage.findOne({ mailboxMessageId: 'NICB-new' }).lean();
    expect(triageRow.purgedAt).toBe('2026-09-28T12:00:00.000Z');
  });

  it('records one audit row per message and a summary', async () => {
    await seedEveryState();

    await discardAwaiting({ now: NOW });

    const rows = await AuditEvent.find({ action: 'EMAIL_PURGED' }).lean();
    const perMessage = rows.filter((entry) => entry.messageId);
    expect(perMessage.map((entry) => entry.messageId).sort()).toEqual([...AWAITING].sort());
    expect(perMessage.every((entry) => entry.details.reason === AWAITING_DISCARD_REASON)).toBe(true);
    const summary = rows.find((entry) => entry.details?.summary);
    expect(summary.details.purged).toBe(4);
    expect(summary.details.reason).toBe(AWAITING_DISCARD_REASON);
  });

  it('changes nothing on a dry run', async () => {
    await seedEveryState();

    const result = await discardAwaiting({ now: NOW, dryRun: true });

    expect(result.discarded).toBe(4);
    expect(result.attachmentsRemoved).toBe(1);
    expect(attachmentStore.remove).not.toHaveBeenCalled();
    for (const id of AWAITING) expect((await row(id)).purgedAt).toBeNull();
    expect(await AuditEvent.find({ action: 'EMAIL_PURGED' }).lean()).toEqual([]);
  });

  it('spares a message somebody decided on after the scan', async () => {
    await storeMessage('NICB-new');
    await storeMessage('NICB-late');
    const findOne = MailboxDecision.findOne.bind(MailboxDecision);
    const spy = vi.spyOn(MailboxDecision, 'findOne').mockImplementation((filter) =>
      filter?.mailboxMessageId === 'NICB-late'
        ? { select: () => ({ lean: async () => ({ _id: 'late-decision' }) }) }
        : findOne(filter),
    );

    const result = await discardAwaiting({ now: NOW });
    spy.mockRestore();

    expect(result.discarded).toBe(1);
    expect(result.skipped.decided).toBe(1);
    expect((await row('NICB-late')).purgedAt).toBeNull();
  });

  it('finds nothing left on a second run', async () => {
    await seedEveryState();
    await discardAwaiting({ now: NOW });

    const again = await discardAwaiting({ now: NOW });

    expect(again.scanned).toBe(0);
    expect(again.discarded).toBe(0);
  });

  it('applies a limit to awaiting mail only, so decided mail cannot use it up', async () => {
    await seedEveryState();

    const result = await discardAwaiting({ now: NOW, limit: 2 });

    expect(result.scanned).toBe(2);
    expect(result.discarded).toBe(2);
    expect((await findAwaiting()).length).toBe(2);
  });
});

describe('the scheduled 42-hour sweep is unaffected', () => {
  it('still purges only old confident junk, leaving awaiting mail alone', async () => {
    await storeMessage('NICB-waiting', { receivedAt: hoursAgo(100), createdAt: hoursAgo(100) });
    await triage('NICB-waiting', { classifiedAt: hoursAgo(100) });
    await storeMessage('NICB-old-junk');
    await triage('NICB-old-junk', { verdict: 'JUNK', confidence: 1, classifiedAt: hoursAgo(50) });

    const result = await sweepOnce({ now: NOW, classify: false, ignoreGrace: true });

    expect(result.purged).toBe(1);
    expect((await row('NICB-old-junk')).purgedAt).toBe('2026-09-28T12:00:00.000Z');
    expect((await row('NICB-waiting')).purgedAt).toBeNull();
  });
});
