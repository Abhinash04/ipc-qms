import { describe, it, expect, afterEach } from 'vitest';
import Dexie from 'dexie';

const DB_NAME = 'qms-migration-test';

const V1_STORES = {
  queries: '&queryId, workflowState, businessStatus, priority, currentAssigneeId, currentWorkflowStepId, updatedAt',
  workflowSteps: '&stepId, queryId, stepType, status, assignedUserId, sequence, [queryId+sequence]',
  reviews: '&reviewId, queryId, stepId, reviewerId, decision, at',
  responseVersions: '&responseId, queryId, version, createdAt',
  auditEvents: '&auditId, queryId, event, actor, at',
  notifications: '&notificationId, queryId, recipientRole, at',
  meta: '&key',
};

const V2_ADDITIONS = {
  emailMessages: '&messageId, threadId, queryId, direction, emailType, timestamp',
  emailThreads: '&threadId, queryId, createdAt',
};

let open;

afterEach(async () => {
  if (open) {
    open.close();
    open = null;
  }
  await Dexie.delete(DB_NAME);
});

describe('Dexie v1 → v2 upgrade', () => {
  it('preserves existing v1 rows and adds the email tables', async () => {
    const v1 = new Dexie(DB_NAME);
    v1.version(1).stores(V1_STORES);
    await v1.open();
    await v1.queries.add({ queryId: 'QRY-2026-00001', workflowState: 'RECEIVED', businessStatus: 'OPEN' });
    await v1.auditEvents.add({ auditId: 'AUD-00001', queryId: 'QRY-2026-00001', event: 'QUERY_RECEIVED' });
    await v1.meta.put({ key: 'counters', value: { AUD: 1 } });
    v1.close();

    open = new Dexie(DB_NAME);
    open.version(1).stores(V1_STORES);
    open.version(2).stores(V2_ADDITIONS);
    await open.open();

    expect(open.verno).toBe(2);

    const query = await open.queries.get('QRY-2026-00001');
    expect(query).toBeDefined();
    expect(query.workflowState).toBe('RECEIVED');
    expect(await open.auditEvents.count()).toBe(1);
    expect((await open.meta.get('counters')).value).toEqual({ AUD: 1 });
    expect(await open.emailMessages.count()).toBe(0);
    expect(await open.emailThreads.count()).toBe(0);
    await open.emailThreads.add({ threadId: 'THREAD-2026-00001', queryId: 'QRY-2026-00001' });
    await open.emailMessages.add({
      messageId: 'MSG-00001',
      threadId: 'THREAD-2026-00001',
      queryId: 'QRY-2026-00001',
      direction: 'INBOUND',
      emailType: 'INCOMING_QUERY',
      timestamp: '2026-08-17T09:00:00.000Z',
    });
    expect(await open.emailMessages.count()).toBe(1);
  });

  it('indexes messages by threadId and queryId', async () => {
    open = new Dexie(DB_NAME);
    open.version(1).stores(V1_STORES);
    open.version(2).stores(V2_ADDITIONS);
    await open.open();

    await open.emailMessages.bulkAdd([
      { messageId: 'MSG-00001', threadId: 'T-1', queryId: 'Q-1', direction: 'INBOUND', emailType: 'INCOMING_QUERY', timestamp: '2026-08-17T09:00:00.000Z' },
      { messageId: 'MSG-00002', threadId: 'T-1', queryId: 'Q-1', direction: 'OUTBOUND', emailType: 'ACKNOWLEDGEMENT', timestamp: '2026-08-17T09:05:00.000Z' },
      { messageId: 'MSG-00003', threadId: 'T-2', queryId: 'Q-2', direction: 'INBOUND', emailType: 'INCOMING_QUERY', timestamp: '2026-08-17T10:00:00.000Z' },
    ]);

    expect(await open.emailMessages.where('threadId').equals('T-1').count()).toBe(2);
    expect(await open.emailMessages.where('queryId').equals('Q-2').count()).toBe(1);
    expect(await open.emailMessages.where('direction').equals('OUTBOUND').count()).toBe(1);
  });
});
