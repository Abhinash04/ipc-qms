import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { loadAll } from '@/services/db/db';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');

const ATTACHMENTS = [
  { attachmentId: 'att_1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 100 },
  { attachmentId: 'att_2', filename: 'photo.png', mimeType: 'image/png', size: 200 },
];

const fakeForward = (payload) =>
  Promise.resolve({
    from: 'Test Front Officer <front-office@test.invalid>',
    to: ['officer@test.invalid'],
    subject: `Fwd: ${payload.subject} [${payload.queryId}]`,
    body: payload.body,
    providerMessageId: 'mock-msg-forward',
    providerThreadId: 'mock-thread-1',
    sentAt: '2026-08-18T10:00:00.000Z',
    attachments: payload.attachments,
  });

const fakeSend = (payload) =>
  Promise.resolve({
    from: 'AR&D Division <arnd-ipc-mock@example.com>',
    to: [payload.to],
    subject: payload.subject,
    body: payload.body,
    providerMessageId: 'mock-msg-dispatch',
    sentAt: '2026-08-18T12:00:00.000Z',
  });

function mailboxMessage(overrides = {}) {
  return {
    mailboxMessageId: 'MSG-ATT-PERSIST-1',
    to: 'ipc-query-mock@example.com',
    from: `${INQUIRER.name} <${INQUIRER.email}>`,
    subject: 'Enquiry with attachments',
    body: 'Please see attached.',
    attachments: ATTACHMENTS,
    receivedAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

/** Polls Dexie directly rather than the store's `hydrate()` guard, since a
 *  transition's write to IndexedDB happens in the background (fire-and-forget
 *  inside applyTransition) and is not awaited by the action that triggered it. */
async function waitForPersistedQuery(queryId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const stored = await loadAll();
    const found = stored.queries.find((q) => q.queryId === queryId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`query ${queryId} was never persisted to IndexedDB`);
}

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('attachments persist against the correct Case ID', () => {
  it('raiseEnquiry (portal intake) binds attachments to the new query', () => {
    const { queryId } = s().raiseEnquiry(
      {
        subject: 'Portal enquiry with attachments',
        body: 'Body',
        inquirer: { id: INQUIRER.id, name: INQUIRER.name, email: INQUIRER.email },
        providerMessageId: 'sent-by-inquirer',
        attachments: ATTACHMENTS,
      },
      async () => null,
    );

    expect(s().getQuery(queryId).attachments).toEqual(ATTACHMENTS);
  });

  it('ingestEmail (mailbox intake) binds attachments to the new query', () => {
    const { queryId } = s().ingestEmail(mailboxMessage(), async () => null);
    expect(s().getQuery(queryId).attachments).toEqual(ATTACHMENTS);
  });

  it('two different cases keep their own attachments — no cross-contamination', () => {
    const { queryId: first } = s().ingestEmail(
      mailboxMessage({ mailboxMessageId: 'MSG-ATT-PERSIST-A' }),
      async () => null,
    );
    const { queryId: second } = s().ingestEmail(
      mailboxMessage({
        mailboxMessageId: 'MSG-ATT-PERSIST-B',
        attachments: [{ attachmentId: 'att_3', filename: 'other.docx', mimeType: 'application/msword', size: 50 }],
      }),
      async () => null,
    );

    expect(s().getQuery(first).attachments).toEqual(ATTACHMENTS);
    expect(s().getQuery(second).attachments.map((a) => a.attachmentId)).toEqual(['att_3']);
  });

  it('survives a real IndexedDB round trip (Dexie), not just in-memory state', async () => {
    const { queryId } = s().ingestEmail(
      mailboxMessage({ mailboxMessageId: 'MSG-ATT-PERSIST-DEXIE' }),
      async () => null,
    );

    const stored = await waitForPersistedQuery(queryId);
    expect(stored.attachments).toEqual(ATTACHMENTS);
  });

  it('attachments survive the full lifecycle through to CLOSED', async () => {
    const { queryId } = s().ingestEmail(
      mailboxMessage({ mailboxMessageId: 'MSG-ATT-PERSIST-LIFECYCLE' }),
      async () => null,
    );

    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    await s().generateAiDraft(queryId, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
    s().submitForReview(queryId, OFFICIAL);
    s().approveReview(queryId, 'Approved', REVIEWER);
    await s().grantFinalApproval(queryId, OIC, fakeSend);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(s().getQuery(queryId).attachments).toEqual(ATTACHMENTS);
  });
});
