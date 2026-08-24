import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildLifecycle, STAGE, STAGE_STATUS } from '@/constants/queryLifecycle';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');
const INQUIRER = findUserById('USR-0001');

const fakeForward = (payload) =>
  Promise.resolve({
    from: 'Test Front Officer <front-office@test.invalid>',
    to: ['officer@test.invalid'],
    subject: `Fwd: ${payload.subject}`,
    body: payload.body,
    providerMessageId: 'mock-msg-forward',
    providerThreadId: payload.providerThreadId || 'mock-thread-1',
    sentAt: '2026-08-18T10:00:00.000Z',
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

const enquiry = () => ({
  mailboxMessageId: 'MSG-00001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Clarification on monograph revision',
  body: 'Please clarify the applicable monograph.',
  receivedAt: '2026-08-18T09:00:00.000Z',
});

function lifecycleOf(queryId) {
  return buildLifecycle({
    query: s().getQuery(queryId),
    steps: s().getSteps(queryId),
    versions: s().getVersions(queryId),
    reviews: s().getReviews(queryId),
    audit: s().getAudit(queryId),
    messages: s().emailMessages.filter((m) => m.queryId === queryId),
  });
}

const currentOf = (queryId) =>
  lifecycleOf(queryId).find((stage) => stage.status === STAGE_STATUS.CURRENT);

const statusOf = (queryId, key) =>
  lifecycleOf(queryId).find((stage) => stage.key === key)?.status;

const reviewStages = (queryId) =>
  lifecycleOf(queryId).filter((stage) => stage.key.startsWith(STAGE.REVIEW));

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('a query has a full lifecycle rail from the moment it is ingested', () => {
  it('renders stages before any workflow step exists — the reported empty state', () => {
    const { queryId } = s().ingestEmail(enquiry());

    expect(s().getSteps(queryId)).toHaveLength(0);

    const stages = lifecycleOf(queryId);
    expect(stages.length).toBeGreaterThan(5);
    expect(statusOf(queryId, STAGE.SUBMITTED)).toBe(STAGE_STATUS.COMPLETE);
    expect(currentOf(queryId).key).toBe(STAGE.VERIFIED);
    expect(statusOf(queryId, STAGE.DELIVERED)).toBe(STAGE_STATUS.PENDING);
  });

  it('names the inquirer on the first stage and the OIC on final approval', () => {
    const { queryId } = s().ingestEmail(enquiry());
    const stages = lifecycleOf(queryId);

    expect(stages[0].actor).toBe(INQUIRER.name);
    expect(stages.find((st) => st.key === STAGE.FINAL_APPROVAL).actor).toBeTruthy();
  });

  it('returns an empty rail for a missing query rather than throwing', () => {
    expect(buildLifecycle({ query: null })).toEqual([]);
    expect(buildLifecycle()).toEqual([]);
  });
});

describe('the current stage advances with the workflow', () => {
  it('walks received → verified → forwarded → assigned → drafted', async () => {
    const { queryId } = s().ingestEmail(enquiry());
    expect(currentOf(queryId).key).toBe(STAGE.VERIFIED);

    s().verifyQuery(queryId, FRONT_OFFICE);
    expect(currentOf(queryId).key).toBe(STAGE.FORWARDED);

    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    expect(currentOf(queryId).key).toBe(STAGE.ASSIGNED);

    s().assignQuery(queryId, OFFICIAL.id, OIC);
    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);

    s().generateAiDraft(queryId, OFFICIAL);
    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);
  });
});

describe('review levels expand from the real steps', () => {
  async function toReview(reviewers) {
    const { queryId } = s().ingestEmail(enquiry());
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    s().generateAiDraft(queryId, OFFICIAL);
    for (const reviewer of reviewers) {
      s().addReviewLevel(queryId, reviewer.id, OFFICIAL);
    }
    s().submitForReview(queryId, OFFICIAL);
    return queryId;
  }

  it('names two levels Reviewer I and Reviewer II with their assignees', async () => {
    const queryId = await toReview([REVIEWER_A, REVIEWER_B]);
    const levels = reviewStages(queryId);

    expect(levels.map((st) => st.label)).toEqual(['Reviewer I', 'Reviewer II']);
    expect(levels.map((st) => st.actor)).toEqual([REVIEWER_A.name, REVIEWER_B.name]);
    expect(levels.map((st) => st.status)).toEqual([STAGE_STATUS.CURRENT, STAGE_STATUS.PENDING]);
  });

  it('hands the current marker to Reviewer II once Reviewer I approves', async () => {
    const queryId = await toReview([REVIEWER_A, REVIEWER_B]);
    s().approveReview(queryId, 'ok', REVIEWER_A);

    expect(reviewStages(queryId).map((st) => st.status)).toEqual([
      STAGE_STATUS.COMPLETE,
      STAGE_STATUS.CURRENT,
    ]);
  });

  it('expands to three levels — nothing is hard-coded to two', async () => {
    const queryId = await toReview([REVIEWER_A, REVIEWER_B, REVIEWER_A]);

    expect(reviewStages(queryId).map((st) => st.label)).toEqual([
      'Reviewer I',
      'Reviewer II',
      'Reviewer III',
    ]);
  });

  it('shows a single Review placeholder before any level is chosen', () => {
    const { queryId } = s().ingestEmail(enquiry());
    const levels = reviewStages(queryId);

    expect(levels).toHaveLength(1);
    expect(levels[0].label).toBe('Review');
    expect(levels[0].status).toBe(STAGE_STATUS.PENDING);
  });

  it('moves to final approval after the last level approves', async () => {
    const queryId = await toReview([REVIEWER_A, REVIEWER_B]);
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().approveReview(queryId, 'ok', REVIEWER_B);

    expect(currentOf(queryId).key).toBe(STAGE.FINAL_APPROVAL);
  });
});

describe('a returned revision sends the rail back to the assigned official', () => {
  async function toReview() {
    const { queryId } = s().ingestEmail(enquiry());
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    s().generateAiDraft(queryId, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
    s().submitForReview(queryId, OFFICIAL);
    return queryId;
  }

  it('makes the draft stage current again, not the next review level', async () => {
    const queryId = await toReview();
    s().requestRevision(queryId, 'Cite the monograph edition.', REVIEWER_A);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.RETURNED_FOR_REVISION);
    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);
    expect(reviewStages(queryId).map((st) => st.status)).toEqual([
      STAGE_STATUS.PENDING,
      STAGE_STATUS.PENDING,
    ]);
  });

  it('names the reviewer who asked for the changes', async () => {
    const queryId = await toReview();
    s().requestRevision(queryId, 'Cite the monograph edition.', REVIEWER_A);

    expect(currentOf(queryId).note).toContain(REVIEWER_A.name);
  });

  it('reverts even from Reviewer II, rather than continuing forward', async () => {
    const queryId = await toReview();
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().requestRevision(queryId, 'Add the method.', REVIEWER_B);

    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);
    expect(currentOf(queryId).note).toContain(REVIEWER_B.name);
  });

  it('tracks the version count across v2 and v3 cycles', async () => {
    const queryId = await toReview();
    const keysBefore = lifecycleOf(queryId).map((st) => st.key);

    s().requestRevision(queryId, 'Round 1', REVIEWER_A);
    s().saveDraftVersion(queryId, 'v2 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().requestRevision(queryId, 'Round 2', REVIEWER_B);
    s().saveDraftVersion(queryId, 'v3 text', OFFICIAL, 'Revision after review');

    expect(currentOf(queryId).label).toBe('Response drafted (v3)');
    expect(lifecycleOf(queryId).map((st) => st.key)).toEqual(keysBefore);
  });
});

describe('a closed query reads as fully complete', () => {
  it('leaves no current stage and marks dispatch and delivery done', async () => {
    const { queryId } = s().ingestEmail(enquiry());
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    s().generateAiDraft(queryId, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
    s().submitForReview(queryId, OFFICIAL);
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().approveReview(queryId, 'ok', REVIEWER_B);
    await s().grantFinalApproval(queryId, OIC, fakeSend);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(currentOf(queryId)).toBeUndefined();
    expect(
      lifecycleOf(queryId).every((st) => st.status === STAGE_STATUS.COMPLETE),
    ).toBe(true);
  });
});
