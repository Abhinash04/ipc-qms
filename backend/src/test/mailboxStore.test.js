import { describe, it, expect, beforeEach } from 'vitest';
import * as mailbox from '../services/email/mailbox/index.js';
import * as memoryMailbox from '../services/email/mailbox/mockIpcMailbox.js';
import * as mongoMailbox from '../services/email/mailbox/mongoIpcMailbox.js';
import { isConnected } from '../config/db.js';

beforeEach(async () => {
  await mailbox.reset();
});

describe('graceful degradation', () => {
  it('does not require a database connection', () => {
    expect(isConnected()).toBe(false);
  });

  it('falls back to the in-memory store and says so', () => {
    const described = mailbox.describe();
    expect(described.backend).toBe('in-memory');
    expect(described.persistence).toMatch(/cleared on backend restart/);
  });
});

describe('facade behaviour is identical regardless of backend', () => {
  it('delivers, lists and marks ingested', async () => {
    const delivered = await mailbox.deliver({
      to: 'ipc-query-mock@example.com',
      from: 'abhinash.pritiraj@gmail.com',
      subject: 'Facade test',
      body: 'Body',
      receivedAt: '2026-08-17T09:00:00.000Z',
    });

    expect(delivered.mailboxMessageId).toBe('MSG-00001');
    expect(delivered.ingested).toBe(false);

    const listed = await mailbox.list('ipc-query-mock@example.com');
    expect(listed).toHaveLength(1);

    const marked = await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-00001');
    expect(marked.ingested).toBe(true);
    expect(await mailbox.list('ipc-query-mock@example.com', { unreadOnly: true })).toHaveLength(0);
  });

  it('returns null when marking an unknown message', async () => {
    expect(await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-99999')).toBeNull();
  });

  it('keeps separate inboxes per recipient, so IPC_QUERY_EMAIL can change', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'a@example.com', subject: 'Dev' });
    await mailbox.deliver({ to: 'lab.ipc@gov.in', from: 'a@example.com', subject: 'Prod' });

    expect(await mailbox.list('ipc-query-mock@example.com')).toHaveLength(1);
    expect(await mailbox.list('lab.ipc@gov.in')).toHaveLength(1);
    expect((await mailbox.list('lab.ipc@gov.in'))[0].subject).toBe('Prod');
  });

  it('rejects delivery without a sender or recipient', async () => {
    await expect(mailbox.deliver({ to: 'x@example.com' })).rejects.toThrow(/"from" is required/);
    await expect(mailbox.deliver({ from: 'x@example.com' })).rejects.toThrow(/"to" is required/);
  });

  it('reports stats', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'a@example.com', subject: 'One' });
    await mailbox.deliver({ to: 'other@example.com', from: 'a@example.com', subject: 'Two' });

    expect(await mailbox.stats()).toEqual({ recipients: 2, messages: 2 });
  });
});

describe('determinism (binding constraint)', () => {
  it('mints strictly sequential ids', async () => {
    for (const subject of ['a', 'b', 'c']) {
      await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject });
    }
    expect((await mailbox.list('ipc-query-mock@example.com')).map((m) => m.mailboxMessageId)).toEqual([
      'MSG-00001',
      'MSG-00002',
      'MSG-00003',
    ]);
  });

  it('reproduces the same ids after reset — no random or time-based ids', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'first run' });
    const firstRun = (await mailbox.list('ipc-query-mock@example.com')).map((m) => m.mailboxMessageId);

    await mailbox.reset();

    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'second run' });
    const secondRun = (await mailbox.list('ipc-query-mock@example.com')).map((m) => m.mailboxMessageId);

    expect(secondRun).toEqual(firstRun);
    expect(secondRun).toEqual(['MSG-00001']);
  });

  it('orders by insertion, not by wall clock', async () => {
    await mailbox.deliver({
      to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'later timestamp',
      receivedAt: '2030-01-01T00:00:00.000Z',
    });
    await mailbox.deliver({
      to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'earlier timestamp',
      receivedAt: '2000-01-01T00:00:00.000Z',
    });

    expect((await mailbox.list('ipc-query-mock@example.com')).map((m) => m.subject)).toEqual([
      'later timestamp',
      'earlier timestamp',
    ]);
  });
});

describe('recipient keying', () => {
  // Regression: the acknowledgement is addressed with the sender string taken
  // from the incoming mail ("Name <addr>"), so delivering under that raw string
  // put it in a second, unreachable inbox — list() looked it up by bare address
  // and found nothing.
  it('treats "Name <addr>" and the bare address as one inbox', async () => {
    await mailbox.deliver({
      to: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
      from: 'arnd-ipc-mock@example.com',
      subject: 'Acknowledgement',
    });

    expect(await mailbox.list('abhinash.pritiraj@gmail.com')).toHaveLength(1);
    expect(await mailbox.list('Abhinash Pritiraj <abhinash.pritiraj@gmail.com>')).toHaveLength(1);
    expect(await mailbox.stats()).toEqual({ recipients: 1, messages: 1 });
  });

  it('ignores case in the address', async () => {
    await mailbox.deliver({ to: 'IPC-Query-Mock@Example.com', from: 'x@example.com', subject: 'A' });
    expect(await mailbox.list('ipc-query-mock@example.com')).toHaveLength(1);
  });

  it('can mark a message ingested using either address form', async () => {
    await mailbox.deliver({
      to: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
      from: 'x@example.com',
      subject: 'A',
    });

    const marked = await mailbox.markIngested(
      'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
      'MSG-00001',
    );
    expect(marked.ingested).toBe(true);
  });
});

describe('ingestion replay protection (backend guard)', () => {
  it('marking ingested is idempotent', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'Once' });

    const first = await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-00001');
    const second = await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-00001');

    expect(first.ingested).toBe(true);
    expect(second.ingested).toBe(true);
    expect(await mailbox.list('ipc-query-mock@example.com')).toHaveLength(1);
  });

  it('unreadOnly excludes already-ingested mail, so a restart does not replay it', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'Processed' });
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'Pending' });

    await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-00001');

    const toProcess = await mailbox.list('ipc-query-mock@example.com', { unreadOnly: true });
    expect(toProcess).toHaveLength(1);
    expect(toProcess[0].subject).toBe('Pending');
    expect(await mailbox.list('ipc-query-mock@example.com')).toHaveLength(2);
  });

  it('an ingested message stays ingested when listed again', async () => {
    await mailbox.deliver({ to: 'ipc-query-mock@example.com', from: 'x@example.com', subject: 'Sticky' });
    await mailbox.markIngested('ipc-query-mock@example.com', 'MSG-00001');

    const [message] = await mailbox.list('ipc-query-mock@example.com');
    expect(message.ingested).toBe(true);
  });
});

describe('the two mailbox implementations share one interface', () => {
  it('exposes the same operations', () => {
    for (const fn of ['deliver', 'list', 'markIngested', 'reset', 'stats']) {
      expect(typeof memoryMailbox[fn], `memory.${fn}`).toBe('function');
      expect(typeof mongoMailbox[fn], `mongo.${fn}`).toBe('function');
    }
  });
});
