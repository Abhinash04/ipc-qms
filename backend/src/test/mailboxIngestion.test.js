import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The NICeMail ingestion service: what `sync()` makes of what the browser
 * reader hands it. No browser — the reader is the `reader` seam — and the
 * models are the in-memory stand-in from support/memoryDb.js.
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
  return {
    ...actual,
    MailboxTriage: memoryDb.model('MailboxTriage', { unique: ['mailboxMessageId'] }),
  };
});
vi.mock('../models/AuditEvent.js', async () => ({
  AuditEvent: (await import('./support/memoryDb.js')).memoryDb.model('AuditEvent'),
}));

import { memoryDb as db } from './support/memoryDb.js';
import { MailboxMessage } from '../models/MailboxMessage.js';
import * as nicMailbox from '../services/email/mailbox/nicBrowserMailbox.js';
import browserConfig from '../config/browserConfig.js';

const NIC_ADDRESS = 'nic-mailbox@test.invalid';

/** One message as the reader returns it (contract C-A). */
const read = (providerMessageId, overrides = {}) => ({
  providerMessageId,
  providerThreadId: null,
  from: 'Anita Rao <anita.rao@example.invalid>',
  to: ['lab.ipc@example.invalid', 'desk@example.invalid'],
  cc: ['clerk@example.invalid'],
  bcc: [],
  subject: `Enquiry ${providerMessageId}`,
  body: 'Please clarify the applicable dissolution limits.',
  bodyHtml: '<p>Please clarify the applicable <b>dissolution</b> limits.</p>',
  unread: true,
  receivedAt: '2026-09-21T05:49:09.000Z',
  receivedAtSource: 'message',
  attachments: [],
  ...overrides,
});

const stored = (providerMessageId) =>
  db.rows('MailboxMessage').find((row) => row.providerMessageId === providerMessageId);

beforeEach(() => {
  db.reset();
  nicMailbox.resetSyncState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is stored for each message', () => {
  it('keeps the To header, the Bcc, the HTML body and where the date came from — filed under the mailbox', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1')] });

    expect(stored('row-1')).toMatchObject({
      to: NIC_ADDRESS,
      toAddresses: ['lab.ipc@example.invalid', 'desk@example.invalid'],
      cc: ['clerk@example.invalid'],
      bcc: [],
      bodyHtml: '<p>Please clarify the applicable <b>dissolution</b> limits.</p>',
      providerThreadId: null,
      providerUnread: true,
      receivedAt: '2026-09-21T05:49:09.000Z',
      receivedAtSource: 'message',
      readAt: null,
      readByUserId: null,
      source: 'nic-browser',
    });
    expect(Date.parse(stored('row-1').createdAt)).not.toBeNaN();
  });

  it('drops an HTML body over the limit and keeps the text', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1', { bodyHtml: 'x'.repeat(1000001) })] });

    expect(stored('row-1')).toMatchObject({ bodyHtml: null, body: 'Please clarify the applicable dissolution limits.' });
  });

  it('says when the date is only the time of the read', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1', { receivedAt: null, receivedAtSource: undefined })] });

    expect(stored('row-1').receivedAtSource).toBe('sync');
    expect(Date.parse(stored('row-1').receivedAt)).not.toBeNaN();
  });

  it('accepts only the date sources it knows', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1', { receivedAtSource: 'guess' })] });

    expect(stored('row-1').receivedAtSource).toBeNull();
  });

  it('never rewrites a stored message when it is read again', async () => {
    await nicMailbox.sync(NIC_ADDRESS, { reader: async () => [read('row-1')] });
    const first = { ...stored('row-1') };

    nicMailbox.resetSyncState();
    await nicMailbox.sync(NIC_ADDRESS, {
      reader: async () => [read('row-1', { bodyHtml: '<p>changed</p>', unread: false, to: ['other@example.invalid'] })],
    });

    expect(stored('row-1')).toEqual(first);
  });
});

/** `sync` itself ignores the poll TTL, so each call here is one full run. */
const syncOnce = (reader, options = {}) => nicMailbox.sync(NIC_ADDRESS, { reader, ...options });

const audits = (action) => db.rows('AuditEvent').filter((row) => row.action === action);

describe('NIC_BROWSER_SYNC_MAX', () => {
  it.each([['0'], ['-5'], ['ten'], ['2.5']])('falls back to 20 for %s, never "all of them"', (value) => {
    vi.stubEnv('NIC_BROWSER_SYNC_MAX', value);
    expect(browserConfig.syncMax).toBe(20);
    vi.unstubAllEnvs();
  });

  it('takes a positive whole number', () => {
    vi.stubEnv('NIC_BROWSER_SYNC_MAX', '2');
    expect(browserConfig.syncMax).toBe(2);
    vi.unstubAllEnvs();
  });
});

describe('storing as it reads', () => {
  it('keeps what was stored before the read stopped, and says how much', async () => {
    const status = await syncOnce(async ({ onMessage }) => {
      await onMessage(read('row-1'));
      throw Object.assign(new Error('The NICeMail agent tab was closed or crashed.'), { stage: 'ui' });
    });

    expect(stored('row-1')).toBeTruthy();
    expect(status).toMatchObject({ ok: false, stored: 1, stage: 'ui' });
  });

  it('stores a message once when a reader both streams and returns it', async () => {
    await syncOnce(async ({ onMessage }) => {
      await onMessage(read('row-1'));
      return { messages: [read('row-1')], failures: [], remaining: 0 };
    });

    expect(db.rows('MailboxMessage')).toHaveLength(1);
  });

  it('lets a failure to store stop the read rather than pass it off as a bad message', async () => {
    const spy = vi.spyOn(MailboxMessage, 'updateOne').mockRejectedValueOnce(new Error('write failed'));

    const status = await syncOnce(async ({ onMessage }) => {
      await onMessage(read('row-1'));
      return { messages: [], failures: [], remaining: 0 };
    });

    expect(spy).toHaveBeenCalled();
    expect(status).toMatchObject({ ok: false, error: 'write failed' });
  });
});

describe('a message that will not read', () => {
  const failing = async () => ({
    messages: [],
    failures: [{ providerMessageId: 'row-9', stage: 'ui', error: 'timed out' }],
    remaining: 0,
  });

  it('is reported, tried again, and left alone after three failed reads', async () => {
    const readers = [];
    const reader = vi.fn(async (args) => {
      readers.push([...args.skip]);
      return failing();
    });

    for (let run = 0; run < 4; run += 1) await syncOnce(reader);

    expect(readers.slice(0, 3).every((skip) => !skip.includes('row-9'))).toBe(true);
    expect(readers[3]).toContain('row-9');
    expect(nicMailbox.syncStatus()).toMatchObject({ ok: true, quarantined: 1 });
  });

  it('is not counted against when the whole read failed — that may be the page', async () => {
    const readers = [];
    const broken = async (args) => {
      readers.push([...args.skip]);
      throw Object.assign(new Error('none could be read'), {
        stage: 'ui',
        failures: [{ providerMessageId: 'row-9', stage: 'ui', error: 'x' }],
      });
    };

    for (let run = 0; run < 4; run += 1) await syncOnce(broken);

    expect(readers.every((skip) => !skip.includes('row-9'))).toBe(true);
  });

  it('is handed back to the reader to try again until it is quarantined', async () => {
    const retries = [];
    const reader = vi.fn(async (args) => {
      retries.push([...args.retry]);
      return failing();
    });

    for (let run = 0; run < 4; run += 1) await syncOnce(reader);

    expect(retries).toEqual([[], ['row-9'], ['row-9'], []]);
  });

  it('shows in the status with the reason', async () => {
    const status = await syncOnce(failing);

    expect(status).toMatchObject({ ok: true, failed: 1, failedMessages: [{ providerMessageId: 'row-9', error: 'timed out' }] });
  });
});

describe('the audit trail', () => {
  const broken = async () => {
    throw Object.assign(new Error('Chrome is not available for browser automation.'), { stage: 'connect_browser' });
  };

  it('records an outage once when it starts and once when it ends', async () => {
    await syncOnce(broken);
    await syncOnce(broken);
    await syncOnce(broken);
    await syncOnce(async () => ({ messages: [], failures: [], remaining: 0 }));

    expect(audits('SYNC_FAILED')).toHaveLength(1);
    expect(audits('SYNC_RECOVERED')).toHaveLength(1);
    expect(audits('SYNC_FAILED')[0]).toMatchObject({ result: 'failure', details: expect.objectContaining({ stage: 'connect_browser' }) });
  });

  it('writes nothing for a quiet poll, and one row for a sync that stored mail', async () => {
    await syncOnce(async () => ({ messages: [], failures: [], remaining: 0 }));
    expect(audits('SYNC_COMPLETED')).toHaveLength(0);

    await syncOnce(async ({ onMessage }) => {
      await onMessage(read('row-1'));
      return { messages: [], failures: [], remaining: 0 };
    });

    expect(audits('SYNC_COMPLETED')).toHaveLength(1);
    expect(audits('SYNC_COMPLETED')[0].details).toMatchObject({ stored: 1, providerMessageIds: ['row-1'], trigger: 'poll' });
  });

  it('always records a sync someone asked for', async () => {
    await syncOnce(async () => ({ messages: [], failures: [], remaining: 0 }), { trigger: 'manual' });

    expect(audits('SYNC_COMPLETED')[0].details).toMatchObject({ trigger: 'manual', stored: 0 });
  });
});
