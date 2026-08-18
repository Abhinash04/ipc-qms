import { describe, it, expect, beforeEach } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { buildSeedState } from '@/constants/mockDomain';
import { loadAll } from '@/services/db/db';
import { BUSINESS_STATUS, WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';

const s = () => useWorkflowStore.getState();

const mailboxMessage = (overrides = {}) => ({
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
  cc: [],
  bcc: [],
  subject: 'Clarification on Magnesium Stearate monograph revision',
  body: 'Please confirm the revised limits and the applicable effective date.',
  attachments: [],
  receivedAt: '2026-08-17T09:00:00.000Z',
  ingested: false,
  ...overrides,
});

beforeEach(async () => {
  await s().resetDemo();
});

describe('requirement 1 — the system starts with zero queries', () => {
  it('seeds no queries, threads, messages or audit events', () => {
    const seed = buildSeedState();
    expect(seed.queries).toEqual([]);
    expect(seed.workflowSteps).toEqual([]);
    expect(seed.emailMessages).toEqual([]);
    expect(seed.emailThreads).toEqual([]);
    expect(seed.auditEvents).toEqual([]);
    expect(seed.notifications).toEqual([]);
  });

  it('starts all id counters at zero', () => {
    expect(buildSeedState().counters).toEqual({
      QRY: 0, THREAD: 0, MSG: 0, AUD: 0, NOTIF: 0, STEP: 0, REV: 0, RESP: 0,
    });
  });

  it('a freshly reset store is empty', () => {
    expect(s().queries).toHaveLength(0);
    expect(s().emailMessages).toHaveLength(0);
    expect(s().auditEvents).toHaveLength(0);
  });

  it('there is no residual dummy query id anywhere in the store', () => {
    const serialised = JSON.stringify({
      queries: s().queries, messages: s().emailMessages, audit: s().auditEvents,
    });
    expect(serialised).not.toMatch(/QRY-2026-00427|QRY-2026-0043\d/);
  });
});

describe('requirement 2 — a query is created dynamically from an email', () => {
  it('creates exactly one query at OPEN / RECEIVED', () => {
    const result = s().ingestEmail(mailboxMessage());

    expect(result.created).toBe(true);
    expect(s().queries).toHaveLength(1);

    const query = s().getQuery(result.queryId);
    expect(query.businessStatus).toBe(BUSINESS_STATUS.OPEN);
    expect(query.workflowState).toBe(WORKFLOW_STATE.RECEIVED);
    expect(query.currentAssigneeId).toBeNull();
    expect(query.currentWorkflowStepId).toBeNull();
  });

  it('carries the real email content onto the query', () => {
    const { queryId } = s().ingestEmail(mailboxMessage());
    const query = s().getQuery(queryId);

    expect(query.subject).toBe('Clarification on Magnesium Stearate monograph revision');
    expect(query.description).toContain('revised limits');
    expect(query.source).toBe('Email');
    expect(query.inquirer.email).toBe('abhinash.pritiraj@gmail.com');
    expect(query.inquirer.name).toBe('Abhinash Pritiraj');
    expect(query.inquirer.id).toBe('USR-0001');
  });

  it('mints the documented id shapes, sequentially', () => {
    const first = s().ingestEmail(mailboxMessage());
    expect(first.queryId).toBe('QRY-2026-00001');
    expect(first.threadId).toBe('THREAD-2026-00001');
    expect(first.messageId).toBe('MSG-00001');

    const second = s().ingestEmail(mailboxMessage({ mailboxMessageId: 'MSG-00002', subject: 'Second' }));
    expect(second.queryId).toBe('QRY-2026-00002');
    expect(second.threadId).toBe('THREAD-2026-00002');
  });

  it('records the inbound message with the QMS/IPC direction convention', () => {
    const { messageId } = s().ingestEmail(mailboxMessage());
    const message = s().emailMessages.find((m) => m.messageId === messageId);

    expect(message.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(message.emailType).toBe(EMAIL_TYPE.INCOMING_QUERY);
    expect(message.to).toEqual(['ipc-query-mock@example.com']);
  });

  it('emits exactly one QUERY_RECEIVED audit event and notifies Front Office', () => {
    const { queryId } = s().ingestEmail(mailboxMessage());

    const received = s().getAudit(queryId).filter((a) => a.event === AUDIT_EVENT.QUERY_RECEIVED);
    expect(received).toHaveLength(1);
    expect(s().notifications.filter((n) => n.queryId === queryId)).toHaveLength(1);
    expect(s().notifications[0].recipientRole).toBe('FRONT_OFFICE');
  });
});

describe('requirement 3 — queryId ⇄ messageId ⇄ threadId stay linked', () => {
  it('links the query, its source message and its thread in both directions', () => {
    const { queryId, threadId, messageId } = s().ingestEmail(mailboxMessage());

    const query = s().getQuery(queryId);
    const message = s().emailMessages.find((m) => m.messageId === messageId);
    const thread = s().emailThreads.find((t) => t.threadId === threadId);

    expect(query.sourceEmailId).toBe(messageId);
    expect(query.threadId).toBe(threadId);
    expect(message.queryId).toBe(queryId);
    expect(message.threadId).toBe(threadId);
    expect(thread.queryId).toBe(queryId);
  });

  it('keeps the link to the originating mailbox message', () => {
    const { messageId } = s().ingestEmail(mailboxMessage({ mailboxMessageId: 'MSG-00042' }));
    const message = s().emailMessages.find((m) => m.messageId === messageId);
    expect(message.sourceMessageId).toBe('MSG-00042');
  });

  it('persists all three linked records to IndexedDB', async () => {
    const { queryId, threadId, messageId } = s().ingestEmail(mailboxMessage());
    await new Promise((r) => setTimeout(r, 50));

    const stored = await loadAll();
    expect(stored.queries.find((q) => q.queryId === queryId)).toBeDefined();
    expect(stored.emailMessages.find((m) => m.messageId === messageId)).toBeDefined();
    expect(stored.emailThreads.find((t) => t.threadId === threadId)).toBeDefined();
  });

  it('gives two different emails two distinct queries and threads', () => {
    const a = s().ingestEmail(mailboxMessage({ mailboxMessageId: 'MSG-00001', subject: 'First' }));
    const b = s().ingestEmail(mailboxMessage({ mailboxMessageId: 'MSG-00002', subject: 'Second' }));

    expect(a.queryId).not.toBe(b.queryId);
    expect(a.threadId).not.toBe(b.threadId);
    expect(s().queries).toHaveLength(2);
  });
});

describe('requirement 5 — ingestion is idempotent', () => {
  it('re-ingesting the same message creates nothing new', () => {
    const first = s().ingestEmail(mailboxMessage());
    const second = s().ingestEmail(mailboxMessage());

    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-ingested');
    expect(second.queryId).toBe(first.queryId);

    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages).toHaveLength(1);
    expect(s().emailThreads).toHaveLength(1);
  });

  it('does not emit a second audit event or notification on re-ingest', () => {
    const { queryId } = s().ingestEmail(mailboxMessage());
    const auditBefore = s().getAudit(queryId).length;
    const notifyBefore = s().notifications.length;

    s().ingestEmail(mailboxMessage());

    expect(s().getAudit(queryId)).toHaveLength(auditBefore);
    expect(s().notifications).toHaveLength(notifyBefore);
  });

  it('does not advance the id counters on re-ingest', () => {
    s().ingestEmail(mailboxMessage());
    const countersAfterFirst = { ...s().counters };

    s().ingestEmail(mailboxMessage());

    expect(s().counters).toEqual(countersAfterFirst);
  });

  it('survives a simulated restart — re-ingesting persisted mail creates no duplicate', async () => {
    const first = s().ingestEmail(mailboxMessage());
    await new Promise((r) => setTimeout(r, 50));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], workflowSteps: [], reviews: [], responseVersions: [],
      auditEvents: [], notifications: [], emailMessages: [], emailThreads: [],
    });
    await s().hydrate();

    expect(s().queries).toHaveLength(1);

    const replay = s().ingestEmail(mailboxMessage());

    expect(replay.created).toBe(false);
    expect(replay.queryId).toBe(first.queryId);
    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages).toHaveLength(1);
  });

  it('does not mutate the stored original message on re-ingest (immutability)', () => {
    const { messageId } = s().ingestEmail(mailboxMessage());
    const before = { ...s().emailMessages.find((m) => m.messageId === messageId) };

    s().ingestEmail(mailboxMessage({ subject: 'TAMPERED', body: 'TAMPERED' }));

    const after = s().emailMessages.find((m) => m.messageId === messageId);
    expect(after.subject).toBe(before.subject);
    expect(after.body).toBe(before.body);
  });

  it('exposes the source→query lookup used by the guard', () => {
    const { queryId } = s().ingestEmail(mailboxMessage({ mailboxMessageId: 'MSG-00007' }));
    expect(s().findQueryBySourceMessage('MSG-00007')).toBe(queryId);
    expect(s().findQueryBySourceMessage('MSG-99999')).toBeNull();
  });

  it('requires a source message id', () => {
    expect(() => s().ingestEmail({ from: 'x@example.com', to: 'y@example.com' })).toThrow(
      /mailboxMessageId or providerMessageId/,
    );
  });
});
