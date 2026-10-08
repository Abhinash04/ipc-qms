import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildLifecycle, STAGE, STAGE_STATUS } from '@/constants/queryLifecycle';
import { buildSpecialEvents, SPECIAL_EVENT } from '@/constants/workflowExceptions';
import { fakeFinalApprovalEndpoint } from '@/test/fakeFinalApprovalEndpoint';
import { fakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

const CHANGES_NOTE = 'Revised as requested.';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');

const caseMail = fakeCaseMail();
const fakeForward = caseMail.forwardQuery;

const fakeSend = (payload) =>
  Promise.resolve({
    from: 'Indian Pharmacopoeia Commission (IPC) <ipc-mock@example.com>',
    to: [payload.to],
    subject: payload.subject,
    body: payload.body,
    providerMessageId: 'mock-msg-dispatch',
    sentAt: '2026-08-18T12:00:00.000Z',
  });

const finalApproval = () => fakeFinalApprovalEndpoint({ send: fakeSend });

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

const changeRequestsOf = (queryId) =>
  buildSpecialEvents({ query: s().getQuery(queryId), audit: s().getAudit(queryId), reviews: s().getReviews(queryId) }).filter(
    (event) => event.type === SPECIAL_EVENT.CHANGES_REQUESTED,
  );

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

    await s().generateAiDraft(queryId, OFFICIAL);
    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);
  });
});

describe('review levels expand from the real steps', () => {
  async function toReview(reviewers) {
    const { queryId } = s().ingestEmail(enquiry());
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    await s().generateAiDraft(queryId, OFFICIAL);
    for (const reviewer of reviewers) {
      s().addReviewLevel(queryId, reviewer.id, OFFICIAL);
    }
    s().submitForReview(queryId, OFFICIAL, { changeSummary: CHANGES_NOTE });
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
    await s().generateAiDraft(queryId, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
    s().submitForReview(queryId, OFFICIAL, { changeSummary: CHANGES_NOTE });
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

  it('records the request as a change-request event by the reviewer, not as a note on the stage', async () => {
    const queryId = await toReview();
    s().requestRevision(queryId, 'Cite the monograph edition.', REVIEWER_A);

    expect(currentOf(queryId).note).toBeUndefined();
    expect(changeRequestsOf(queryId)).toEqual([
      expect.objectContaining({
        type: SPECIAL_EVENT.CHANGES_REQUESTED,
        by: expect.objectContaining({ name: REVIEWER_A.name }),
        reason: 'Cite the monograph edition.',
        rejected: false,
      }),
    ]);
  });

  it('reverts even from Reviewer II, rather than continuing forward', async () => {
    const queryId = await toReview();
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().requestRevision(queryId, 'Add the method.', REVIEWER_B);

    expect(currentOf(queryId).key).toBe(STAGE.DRAFTED);
    expect(changeRequestsOf(queryId).map((event) => event.by.name)).toEqual([REVIEWER_B.name]);
  });

  it('tracks the version count across v2 and v3 cycles', async () => {
    const queryId = await toReview();
    const keysBefore = lifecycleOf(queryId).map((st) => st.key);

    s().requestRevision(queryId, 'Round 1', REVIEWER_A);
    s().saveDraftVersion(queryId, 'v2 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL, { changeSummary: CHANGES_NOTE });
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
    await s().generateAiDraft(queryId, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_A.id, OFFICIAL);
    s().addReviewLevel(queryId, REVIEWER_B.id, OFFICIAL);
    s().submitForReview(queryId, OFFICIAL, { changeSummary: CHANGES_NOTE });
    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().approveReview(queryId, 'ok', REVIEWER_B);
    await s().grantFinalApproval(queryId, OIC, finalApproval());

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(currentOf(queryId)).toBeUndefined();
    expect(
      lifecycleOf(queryId).every((st) => st.status === STAGE_STATUS.COMPLETE),
    ).toBe(true);
  });
});

describe('a pulled back query updates workflow progress, and the pull back is an action, not a stage note', () => {
  it('resets current stage to target pullback stage and records the pull back as an event', async () => {
    const { queryId } = s().ingestEmail(enquiry());
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    await s().generateAiDraft(queryId, OFFICIAL);

    const ADMIN_USER = findUserById('USR-0008');
    await s().pullBackQuery(
      queryId,
      WORKFLOW_STATE.PENDING_ASSIGNMENT,
      'Incorrect assignment',
      'Reassigning to appropriate division.',
      ADMIN_USER,
    );

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    expect(currentOf(queryId).key).toBe(STAGE.ASSIGNED);
    expect(lifecycleOf(queryId).some((stage) => /pulled back/i.test(stage.note || ''))).toBe(false);

    const [pullback] = buildSpecialEvents({ query: s().getQuery(queryId), audit: s().getAudit(queryId) });
    expect(pullback).toMatchObject({
      type: SPECIAL_EVENT.PULL_BACK,
      from: { stage: 'Drafting Response' },
      to: { stage: 'Forwarded to Officer-in-Charge' },
      by: { name: ADMIN_USER.name },
      reason: 'Incorrect assignment',
    });
    expect(pullback.at).toBeTruthy();
  });
});

describe('an automatically answered query follows the AI auto-reply path', () => {
  const AUTO_CASE = {
    queryId: 'QRY-2026-00090',
    createdAt: '2026-10-07T05:00:00.000Z',
    workflowState: WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    inquirer: { name: INQUIRER.name, email: INQUIRER.email },
    autoReply: { entryId: 'AR-PARACETAMOL-USE', topic: 'Uses of paracetamol', confidence: 1 },
  };
  const entry = (event, minute, extra = {}) => ({
    event,
    queryId: AUTO_CASE.queryId,
    at: `2026-10-07T05:${String(minute).padStart(2, '0')}:00.000Z`,
    ...extra,
  });
  const ACCEPTED = [
    entry('QUERY_RECEIVED', 0),
    entry('QUERY_REGISTERED', 1, { actorId: FRONT_OFFICE.id, actorRole: 'FRONT_OFFICE' }),
  ];
  const ACKNOWLEDGED = [...ACCEPTED, entry('AI_SUMMARY_GENERATED', 2), entry('ACKNOWLEDGEMENT_SENT', 3)];
  const PREPARED = [...ACKNOWLEDGED, entry('AUTO_REPLY_PREPARED', 4)];
  const SENT = [...PREPARED, entry('RESPONSE_DISPATCHED', 5), entry('QUERY_CLOSED', 5)];

  const rail = (audit, query = {}) => buildLifecycle({ query: { ...AUTO_CASE, ...query }, audit });
  const statuses = (stages) => stages.map((stage) => stage.status);
  const { COMPLETE: C, CURRENT: N, PENDING: P } = STAGE_STATUS;

  it('shows its own six stages, and none of the OIC workflow', () => {
    const stages = rail(ACCEPTED);
    expect(stages.map((stage) => stage.label)).toEqual([
      'Enquiry submitted',
      'AI identified — 100% confidence (eligible for Auto Reply)',
      'FO approved',
      'AI Agent generated summary & acknowledgement',
      'AI Agent generated reply',
      'Reply sent to external inquirer',
    ]);
    const keys = stages.map((stage) => stage.key);
    for (const standard of [STAGE.FORWARDED, STAGE.ASSIGNED, STAGE.DRAFTED, STAGE.FINAL_APPROVAL]) {
      expect(keys).not.toContain(standard);
    }
  });

  it('takes the confidence and topic from the case', () => {
    const [, identified] = rail(ACCEPTED, { autoReply: { ...AUTO_CASE.autoReply, confidence: 0.92 } });
    expect(identified.label).toBe('AI identified — 92% confidence (eligible for Auto Reply)');
    expect(identified.activity).toMatchObject({ actor: 'AI Agent', action: 'Matched the supported question on uses of paracetamol' });
  });

  it('advances stage by stage as the AI agent works', () => {
    expect(statuses(rail(ACCEPTED))).toEqual([C, C, C, N, P, P]);
    expect(statuses(rail(ACKNOWLEDGED))).toEqual([C, C, C, C, N, P]);
    expect(statuses(rail(PREPARED, { workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH }))).toEqual([C, C, C, C, C, N]);
    expect(statuses(rail(SENT, { workflowState: WORKFLOW_STATE.CLOSED }))).toEqual([C, C, C, C, C, C]);
  });

  it('names who did each step', () => {
    const stages = rail(SENT, { workflowState: WORKFLOW_STATE.CLOSED });
    expect(stages[2].activity).toMatchObject({ role: 'Front Office', action: 'Accepted the query for an automatic reply' });
    expect(stages[3].activity).toMatchObject({ actor: 'AI Agent', action: 'Summarised the query and acknowledged the inquirer by email' });
    expect(stages[4].activity).toMatchObject({ actor: 'AI Agent', action: 'Prepared the reply from the supported question' });
    expect(stages[5].activity).toMatchObject({ action: `Reply emailed to ${INQUIRER.email}`, at: '2026-10-07T05:05:00.000Z' });
  });

  it('says how to finish a reply that could not be sent', () => {
    const stages = rail(PREPARED, { workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH });
    expect(stages.at(-1)).toMatchObject({ status: N, note: 'Not sent yet — retry from the mail in the IPC Mailbox' });
  });

  it('never holds back a later step behind an earlier one that failed', () => {
    const noAcknowledgement = [...ACCEPTED, entry('AUTO_REPLY_PREPARED', 4)];
    expect(statuses(rail(noAcknowledgement))).toEqual([C, C, C, C, C, N]);
  });

  it('reads a case answered under the earlier flow, approved by the Front Office', () => {
    const legacy = [...ACCEPTED, entry('AUTO_REPLY_APPROVED', 4), entry('RESPONSE_DISPATCHED', 5)];
    expect(statuses(rail(legacy, { workflowState: WORKFLOW_STATE.CLOSED }))).toEqual([C, C, C, C, C, C]);
  });

  it('leaves a case without an automatic reply on the standard path', () => {
    const keys = buildLifecycle({ query: { ...AUTO_CASE, autoReply: undefined }, audit: ACCEPTED }).map((stage) => stage.key);
    expect(keys).toContain(STAGE.FORWARDED);
    expect(keys).not.toContain(STAGE.AI_REPLY);
  });
});
