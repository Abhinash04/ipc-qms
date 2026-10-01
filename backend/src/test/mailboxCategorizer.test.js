import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
vi.mock('../models/EmailMessage.js', async () => ({
  EmailMessage: (await import('./support/memoryDb.js')).memoryDb.model('EmailMessage'),
}));
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));

import { memoryDb as db } from './support/memoryDb.js';
import env from '../config/env.js';
import { MailboxTriage } from '../models/MailboxTriage.js';
import * as nicMailbox from '../services/email/mailbox/nicBrowserMailbox.js';
import * as categorizer from '../services/email/mailbox/categorizer.js';
import { toMessageViews } from '../services/email/mailbox/messageView.js';
import { purgeCandidateFilter } from '../services/email/mailbox/retention.js';
import { CATEGORY_VERSION, MAIL_CATEGORIES, RELATION_KINDS, UNCLASSIFIED } from '../constants/mailCategories.js';

const NIC_ADDRESS = 'nic-mailbox@test.invalid';
const ORIGINAL_URL = env.GEMMA_API_URL;
const NOW = Date.parse('2026-09-25T10:00:00.000Z');

let replies;

const reply = (fields) => ({
  ok: true,
  status: 200,
  json: async () => ({ answer: JSON.stringify({ verdict: 'GENUINE', confidence: 0, reason: '', ...fields }) }),
});

const promptOf = (call) => JSON.parse(call[1].body).prompt;
const prompts = () => global.fetch.mock.calls.map(promptOf);

function answerBySubject() {
  global.fetch = vi.fn(async (_url, init) => {
    const prompt = JSON.parse(init.body).prompt;
    const subject = prompt.match(/^Subject: "(.*)"$/m)?.[1] ?? '';
    const entry = Object.entries(replies).find(([needle]) => subject.includes(needle));
    return reply(entry ? entry[1] : { category: 'OTHER', categoryConfidence: 0.3 });
  });
}

const read = (providerMessageId, overrides = {}) => ({
  providerMessageId,
  providerThreadId: null,
  from: 'Anita Rao <anita.rao@pharma.example>',
  to: [NIC_ADDRESS],
  cc: [],
  bcc: [],
  subject: `Enquiry ${providerMessageId}`,
  body: 'Please clarify the applicable dissolution limits for paracetamol tablets.',
  unread: true,
  receivedAt: '2026-09-21T05:49:09.000Z',
  receivedAtSource: 'message',
  attachments: [],
  ...overrides,
});

async function ingest(...messages) {
  nicMailbox.resetSyncState();
  await nicMailbox.sync(NIC_ADDRESS, { reader: async () => messages });
  await categorizer.idle();
}

const byProvider = (providerMessageId) =>
  db.rows('MailboxMessage').find((row) => row.providerMessageId === providerMessageId);
const triageOf = (providerMessageId) =>
  db.rows('MailboxTriage').find((row) => row.mailboxMessageId === byProvider(providerMessageId)?.mailboxMessageId);
const audits = (action) => db.rows('AuditEvent').filter((row) => row.action === action);

beforeEach(() => {
  db.reset();
  nicMailbox.resetSyncState();
  categorizer.resetCategorizer();
  env.GEMMA_API_URL = 'http://gemma.test.invalid/api';
  replies = {};
  answerBySubject();
});

afterEach(async () => {
  await categorizer.idle();
  env.GEMMA_API_URL = ORIGINAL_URL;
  vi.restoreAllMocks();
});

describe('categorising new mail right after it is stored', () => {
  it('files a genuine IPC query under Official Queries, with its confidence and reason', async () => {
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9, categoryReason: 'asks about IP dissolution limits' };
    await ingest(read('q-1', { subject: 'Dissolution limits for paracetamol' }));

    expect(triageOf('q-1')).toMatchObject({
      category: MAIL_CATEGORIES.OFFICIAL_QUERY,
      categoryConfidence: 0.9,
      categoryReason: 'asks about IP dissolution limits',
      categorySource: 'gemma',
      predictedCategory: MAIL_CATEGORIES.OFFICIAL_QUERY,
      needsReview: false,
      categoryVersion: CATEGORY_VERSION,
      verdict: 'GENUINE',
      classifier: 'gemma',
    });
    expect(byProvider('q-1').mailCategory).toBe(MAIL_CATEGORIES.OFFICIAL_QUERY);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('files a conference invitation under Events and Invitations', async () => {
    replies.Conference = { category: 'EVENT_INVITATION', categoryConfidence: 0.92 };
    await ingest(read('e-1', { subject: 'Invitation: National Pharmacopoeia Conference', body: 'You are invited to speak.' }));

    expect(byProvider('e-1').mailCategory).toBe(MAIL_CATEGORIES.EVENT_INVITATION);
  });

  it('files a mail-daemon bounce under System Notifications from the rules alone, without asking Gemma', async () => {
    await ingest(read('n-1', { from: 'MAILER-DAEMON@mail.gov.in', subject: 'Undeliverable: your message', body: 'Delivery failed.' }));

    expect(triageOf('n-1')).toMatchObject({
      category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION,
      categorySource: 'rules',
      verdict: 'JUNK',
      ruleClass: 'hard',
    });
    expect(byProvider('n-1').mailCategory).toBe(MAIL_CATEGORIES.SYSTEM_NOTIFICATION);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('files an advertisement and keeps the junk verdict exactly as the purge has always used it', async () => {
    replies.Sale = { verdict: 'JUNK', confidence: 0.93, reason: 'discount offer', category: 'ADVERTISEMENT', categoryConfidence: 0.95 };
    await ingest(read('a-1', { from: 'deals@shop.example', subject: 'Mega Sale on glassware', body: '40% off. Unsubscribe.' }));

    expect(triageOf('a-1')).toMatchObject({
      category: MAIL_CATEGORIES.ADVERTISEMENT,
      verdict: 'JUNK',
      confidence: 0.93,
      classifier: 'gemma',
    });
    expect(audits('EMAIL_CLASSIFIED')).toHaveLength(1);
  });

  it('files an email it cannot place confidently under Other and flags it for review', async () => {
    replies.Hello = { category: 'EVENT_INVITATION', categoryConfidence: 0.4, categoryReason: 'maybe a meeting' };
    await ingest(read('o-1', { subject: 'Hello', body: 'Please see.' }));

    expect(triageOf('o-1')).toMatchObject({
      category: MAIL_CATEGORIES.OTHER,
      needsReview: true,
      predictedCategory: MAIL_CATEGORIES.EVENT_INVITATION,
      predictedConfidence: 0.4,
    });
    expect(triageOf('o-1').categoryReason).toContain('Events and Invitations');
  });

  it('files an answer outside the registry under Other for review', async () => {
    replies.Odd = { category: 'SPAM', categoryConfidence: 0.9 };
    await ingest(read('o-2', { subject: 'Odd one', body: 'Hmm.' }));

    expect(triageOf('o-2')).toMatchObject({ category: MAIL_CATEGORIES.OTHER, needsReview: true, categorySource: 'fallback' });
  });
});

describe('duplicates, follow-ups and similar mail', () => {
  it('marks an identical re-send from the same sender as a duplicate of the first, without merging or deleting it', async () => {
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('d-1', { subject: 'Dissolution limits', receivedAt: '2026-09-21T05:00:00.000Z' }));
    await ingest(read('d-2', { subject: 'Re: Dissolution limits', receivedAt: '2026-09-22T05:00:00.000Z' }));

    expect(triageOf('d-1').category).toBe(MAIL_CATEGORIES.OFFICIAL_QUERY);
    expect(triageOf('d-2')).toMatchObject({
      category: MAIL_CATEGORIES.DUPLICATE,
      categorySource: 'history',
      categoryConfidence: 0.99,
      verdict: 'GENUINE',
      related: [{ kind: RELATION_KINDS.EXACT_DUPLICATE, mailboxMessageId: byProvider('d-1').mailboxMessageId }],
    });
    expect(byProvider('d-2').removedAt).toBeNull();
    expect(byProvider('d-2').purgedAt ?? null).toBeNull();
    expect(db.rows('MailboxMessage')).toHaveLength(2);
  });

  it('does not call an identical email from a different sender a duplicate', async () => {
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('s-1', { subject: 'Dissolution limits' }));
    await ingest(read('s-2', { subject: 'Dissolution limits', from: 'other@lab.example', receivedAt: '2026-09-22T05:00:00.000Z' }));

    expect(triageOf('s-2').category).toBe(MAIL_CATEGORIES.OFFICIAL_QUERY);
  });

  it('links a follow-up that names a case and lets the content decide — chasing is a duplicate', async () => {
    await db.model('QueryCase').create({ queryId: 'QRY-2026-00012', subject: 'Assay of metformin', businessStatus: 'OPEN', inquirer: { email: 'x@y.example' } });
    replies['Any update'] = { category: 'DUPLICATE', categoryConfidence: 0.8, categoryReason: 'chases an open case' };
    await ingest(read('f-1', { subject: 'Any update on QRY-2026-00012?', body: 'Kindly share the status.' }));

    expect(triageOf('f-1')).toMatchObject({
      category: MAIL_CATEGORIES.DUPLICATE,
      categorySource: 'gemma',
      related: [{ kind: RELATION_KINDS.FOLLOW_UP, queryId: 'QRY-2026-00012' }],
    });
    expect(prompts()[0]).toContain('Refers to existing case QRY-2026-00012');
  });

  it('keeps a follow-up that adds new questions under Official Queries, still linked to the case', async () => {
    await db.model('QueryCase').create({ queryId: 'QRY-2026-00012', subject: 'Assay of metformin', businessStatus: 'OPEN' });
    replies['New question'] = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.85 };
    await ingest(read('f-2', { subject: 'New question on QRY-2026-00012', body: 'Also, what is the impurity limit?' }));

    expect(triageOf('f-2')).toMatchObject({
      category: MAIL_CATEGORIES.OFFICIAL_QUERY,
      related: [{ kind: RELATION_KINDS.FOLLOW_UP, queryId: 'QRY-2026-00012' }],
    });
  });

  it('links a reply in the same NICeMail thread as a registered case', async () => {
    await db.model('EmailMessage').create({ queryId: 'QRY-2026-00031', providerThreadId: 'thread-9' });
    replies['Re: Labelling'] = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.8 };
    await ingest(read('t-1', { subject: 'Re: Labelling', providerThreadId: 'thread-9', body: 'Thanks, one more point.' }));

    expect(triageOf('t-1').related).toEqual([
      { kind: RELATION_KINDS.FOLLOW_UP, queryId: 'QRY-2026-00031', mailboxMessageId: null, score: null },
    ]);
    expect(prompts()[0]).toContain('Same conversation thread as existing case QRY-2026-00031');
  });

  it('links a near-identical email from the same sender as similar, and tells the model', async () => {
    const body =
      'We request clarification on the dissolution test conditions for paracetamol tablets in the current IP ' +
      'monograph, including the medium, apparatus, speed and time points used for the test.';
    replies.Paracetamol = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('m-1', { subject: 'Paracetamol dissolution', body, receivedAt: '2026-09-21T05:00:00.000Z' }));
    await ingest(read('m-2', { subject: 'Paracetamol dissolution', body: `${body} Thanks.`, receivedAt: '2026-09-22T05:00:00.000Z' }));

    const [link] = triageOf('m-2').related;
    expect(link).toMatchObject({ kind: RELATION_KINDS.SAME_SENDER_SIMILAR, mailboxMessageId: byProvider('m-1').mailboxMessageId });
    expect(link.score).toBeGreaterThanOrEqual(0.85);
    expect(prompts()[1]).toContain('Very similar');
  });

  it('notes a resemblance to another inquirer’s case, but never pins it as a duplicate', async () => {
    await db.model('QueryCase').create({
      queryId: 'QRY-2026-00005',
      subject: 'Dissolution test for paracetamol tablets',
      description: 'clarification on the dissolution test conditions for paracetamol tablets in the current IP monograph',
      businessStatus: 'CLOSED',
      inquirer: { email: 'someone@else.example' },
    });
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(
      read('r-1', {
        subject: 'Dissolution test for paracetamol tablets',
        body: 'clarification on the dissolution test conditions for paracetamol tablets in the current IP monograph',
      }),
    );

    expect(triageOf('r-1')).toMatchObject({
      category: MAIL_CATEGORIES.OFFICIAL_QUERY,
      related: [{ kind: RELATION_KINDS.RESEMBLES_CASE, queryId: 'QRY-2026-00005' }],
    });
    expect(prompts()[0]).toContain('not a duplicate');
  });

  it('tells the model how earlier mail from a recurring sender was filed', async () => {
    replies.Newsletter = { verdict: 'JUNK', confidence: 0.93, reason: 'newsletter', category: 'ADVERTISEMENT', categoryConfidence: 0.9 };
    for (const day of [1, 2, 3]) {
      await ingest(
        read(`n-${day}`, {
          from: 'news@vendor.example',
          subject: `Newsletter issue ${day}`,
          body: `Issue ${day} of our product news.`,
          receivedAt: `2026-09-0${day}T05:00:00.000Z`,
        }),
      );
    }

    expect(prompts()[2]).toContain('This sender sent 2 earlier email(s) in 30 days: 2 Advertisements and Promotions');
  });
});

describe('storing and reading categories', () => {
  beforeEach(async () => {
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    replies.Conference = { category: 'EVENT_INVITATION', categoryConfidence: 0.9 };
    await ingest(
      read('v-1', { subject: 'Dissolution limits' }),
      read('v-2', { subject: 'Conference on standards', from: 'events@body.example' }),
    );
  });

  it('filters the feed by category and counts every category', async () => {
    const events = await nicMailbox.list(NIC_ADDRESS, { category: MAIL_CATEGORIES.EVENT_INVITATION });
    expect(events.map((message) => message.subject)).toEqual(['Conference on standards']);

    const counts = await nicMailbox.categoryCounts(NIC_ADDRESS, {});
    expect(counts).toMatchObject({
      OFFICIAL_QUERY: 1,
      EVENT_INVITATION: 1,
      SYSTEM_NOTIFICATION: 0,
      ADVERTISEMENT: 0,
      DUPLICATE: 0,
      OTHER: 0,
      [UNCLASSIFIED]: 0,
    });
    expect(await nicMailbox.count(NIC_ADDRESS, { category: MAIL_CATEGORIES.OFFICIAL_QUERY })).toBe(1);
  });

  it('lists mail not yet classified on its own', async () => {
    await db.model('MailboxMessage').create({
      mailboxMessageId: 'NICB-legacy',
      source: 'nic-browser',
      to: NIC_ADDRESS,
      from: 'x@y.example',
      subject: 'Old',
      receivedAt: '2026-09-01T00:00:00.000Z',
      removedAt: null,
    });

    const pending = await nicMailbox.list(NIC_ADDRESS, { category: UNCLASSIFIED });
    expect(pending.map((message) => message.mailboxMessageId)).toEqual(['NICB-legacy']);
  });

  it('returns the category with the message view', async () => {
    const [view] = await toMessageViews([byProvider('v-2')]);
    expect(view.triage).toMatchObject({
      category: MAIL_CATEGORIES.EVENT_INVITATION,
      categoryConfidence: 0.9,
      categorySource: 'gemma',
      needsReview: false,
      related: [],
    });
  });
});

describe('the Front Officer corrects a category', () => {
  it('keeps the prediction, records who changed it, and is never overwritten by a later run', async () => {
    replies.Hello = { category: 'ADVERTISEMENT', categoryConfidence: 0.8 };
    await ingest(read('c-1', { subject: 'Hello there', body: 'Ping.' }));
    const message = byProvider('c-1');

    const view = await categorizer.correctCategory(message, MAIL_CATEGORIES.EVENT_INVITATION, { userId: 'USR-0014', role: 'FRONT_OFFICE' });

    expect(view).toMatchObject({
      category: MAIL_CATEGORIES.EVENT_INVITATION,
      categorySource: 'human',
      predictedCategory: MAIL_CATEGORIES.ADVERTISEMENT,
      categoryCorrectedByUserId: 'USR-0014',
    });
    expect(byProvider('c-1').mailCategory).toBe(MAIL_CATEGORIES.EVENT_INVITATION);
    expect(audits('EMAIL_CLASSIFIED').at(-1)).toMatchObject({
      actorType: 'human',
      actorId: 'USR-0014',
      details: expect.objectContaining({ category: 'EVENT_INVITATION', previous: 'ADVERTISEMENT', corrected: true }),
    });

    await MailboxTriage.updateOne({ mailboxMessageId: message.mailboxMessageId }, { $set: { categoryVersion: 0 } });
    await categorizer.categorizePending({ now: NOW });
    expect(triageOf('c-1').category).toBe(MAIL_CATEGORIES.EVENT_INVITATION);
  });

  it('rescues junk from the purge when it is corrected to an official query', async () => {
    replies.Sale = { verdict: 'JUNK', confidence: 0.93, reason: 'promo', category: 'ADVERTISEMENT', categoryConfidence: 0.9 };
    await ingest(read('c-2', { subject: 'Sale of reference standards', body: 'Order now.' }));
    expect(triageOf('c-2').verdict).toBe('JUNK');

    await categorizer.correctCategory(byProvider('c-2'), MAIL_CATEGORIES.OFFICIAL_QUERY, { userId: 'USR-0014' });

    const row = triageOf('c-2');
    expect(row).toMatchObject({ verdict: 'GENUINE', rescuedByUserId: 'USR-0014', category: MAIL_CATEGORIES.OFFICIAL_QUERY });
    expect(row.rescuedAt).not.toBeNull();
    expect(await MailboxTriage.countDocuments(purgeCandidateFilter({ now: NOW + 365 * 864e5 }))).toBe(0);
  });

  it('never makes mail purgeable when it is corrected to an advertisement', async () => {
    replies.Dissolution = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('c-3', { subject: 'Dissolution limits' }));

    await categorizer.correctCategory(byProvider('c-3'), MAIL_CATEGORIES.ADVERTISEMENT, { userId: 'USR-0014' });

    expect(triageOf('c-3')).toMatchObject({ verdict: 'GENUINE', category: MAIL_CATEGORIES.ADVERTISEMENT });
    expect(await MailboxTriage.countDocuments(purgeCandidateFilter({ now: NOW + 365 * 864e5 }))).toBe(0);
  });
});

describe('when Gemma is unavailable', () => {
  it('still stores every message, files it by keywords, and retries Gemma later', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await ingest(read('u-1', { subject: 'Invitation to a pharmacopoeia conference', body: 'Join our seminar. Register now.' }));

    expect(byProvider('u-1')).toBeTruthy();
    expect(triageOf('u-1')).toMatchObject({
      category: MAIL_CATEGORIES.EVENT_INVITATION,
      categorySource: 'fallback',
      attempts: 1,
      gemmaAt: null,
      classifier: 'fallback',
    });

    replies.Invitation = { category: 'EVENT_INVITATION', categoryConfidence: 0.93 };
    answerBySubject();
    await categorizer.categorizePending({ now: NOW });

    expect(triageOf('u-1')).toMatchObject({ categorySource: 'gemma', categoryConfidence: 0.93, classifier: 'gemma' });
  });

  it('uses keywords alone, and never touches the verdict, when no model is configured', async () => {
    env.GEMMA_API_URL = '';
    await ingest(read('u-2', { subject: 'New sign-in to your account', body: 'Your verification code is 1234.' }));

    expect(triageOf('u-2')).toMatchObject({
      category: MAIL_CATEGORIES.SYSTEM_NOTIFICATION,
      categorySource: 'fallback',
      attempts: 0,
      classifier: 'rules',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never lets a categoriser failure interrupt the sync', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(MailboxTriage, 'find').mockImplementation(() => {
      throw new Error('categoriser exploded');
    });

    nicMailbox.resetSyncState();
    const status = await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('x-1')] });
    await categorizer.idle();

    expect(status).toMatchObject({ ok: true, stored: 1 });
    expect(byProvider('x-1')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('categoriser exploded'));
  });
});

describe('no duplicate classification jobs', () => {
  it('asks Gemma once per message however often the mailbox is synchronised', async () => {
    replies.Enquiry = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    const inbox = [read('j-1'), read('j-2', { body: 'Another, different question about assay.' })];

    for (let round = 0; round < 3; round += 1) await ingest(...inbox);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(db.rows('MailboxMessage')).toHaveLength(2);
  });

  it('asks once even when new-mail runs and the sweep overlap', async () => {
    replies.Enquiry = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    nicMailbox.resetSyncState();
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('k-1')] });
    const id = byProvider('k-1').mailboxMessageId;

    categorizer.kick([id]);
    categorizer.kick([id]);
    await Promise.all([categorizer.categorizePending({ now: NOW }), categorizer.categorizeBacklog({ now: NOW }), categorizer.idle()]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reclassifies machine-filed mail when the logic version moves on, but leaves human corrections alone', async () => {
    replies.Enquiry = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('v-1'), read('v-2', { body: 'A different question about impurities.' }));
    await categorizer.correctCategory(byProvider('v-2'), MAIL_CATEGORIES.OTHER, { userId: 'USR-0014' });
    await MailboxTriage.updateMany({}, { $set: { categoryVersion: 0 } });
    global.fetch.mockClear();

    await categorizer.categorizePending({ now: NOW });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(triageOf('v-1').categoryVersion).toBe(CATEGORY_VERSION);
    expect(triageOf('v-2')).toMatchObject({ category: MAIL_CATEGORIES.OTHER, categorySource: 'human' });
  });

  it('leaves purged mail alone', async () => {
    replies.Enquiry = { category: 'OFFICIAL_QUERY', categoryConfidence: 0.9 };
    await ingest(read('p-1'));
    await MailboxTriage.updateMany({}, { $set: { categoryVersion: 0, purgedAt: '2026-09-24T00:00:00.000Z' } });
    global.fetch.mockClear();

    await categorizer.categorizePending({ now: NOW });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('backfilling mail stored before triage existed', () => {
  it('gives it a category-only row that can never be purged, then categorises it', async () => {
    await db.model('MailboxMessage').create({
      mailboxMessageId: 'NICB-old',
      source: 'nic-browser',
      to: NIC_ADDRESS,
      from: 'deals@shop.example',
      subject: 'Sale on glassware',
      body: 'Huge discounts.',
      receivedAt: '2026-08-01T00:00:00.000Z',
      removedAt: null,
      purgedAt: null,
    });
    replies.Sale = { verdict: 'JUNK', confidence: 0.95, reason: 'promo', category: 'ADVERTISEMENT', categoryConfidence: 0.9 };

    expect(await categorizer.backfillMissingRows({ sources: ['nic-browser'], now: NOW })).toBe(1);
    expect(await categorizer.backfillMissingRows({ sources: ['nic-browser'], now: NOW })).toBe(0);
    await categorizer.categorizePending({ now: NOW });

    const row = db.rows('MailboxTriage').find((entry) => entry.mailboxMessageId === 'NICB-old');
    expect(row).toMatchObject({ category: MAIL_CATEGORIES.ADVERTISEMENT, verdict: 'GENUINE', confidence: 0 });
    expect(await MailboxTriage.countDocuments(purgeCandidateFilter({ now: NOW + 365 * 864e5 }))).toBe(0);
  });
});
