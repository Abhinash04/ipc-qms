import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import {
  WORKFLOW_STATE,
  BUSINESS_STATUS,
  AUDIT_EVENT,
  RESPONSE_SOURCE,
  RESPONSE_STATUS,
} from '@/constants/statusEnums';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER_A = findUserById('USR-0005');
const REVIEWER_B = findUserById('USR-0006');
const INQUIRER = findUserById('USR-0001');
const ADMIN = findUserById('USR-0007');

const fakeForward = (payload) =>
  Promise.resolve({
    from: 'Test Front Officer <front-office@test.invalid>',
    to: ['officer@test.invalid'],
    subject: `Fwd: ${payload.subject} [${payload.queryId}]`,
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

function mailboxMessage(overrides = {}) {
  return {
    mailboxMessageId: 'MSG-00001',
    to: 'ipc-query-mock@example.com',
    from: 'Abhinash Pritiraj <abhinash.pritiraj@gmail.com>',
    subject: 'Clarification on monograph revision and impurity limits',
    body:
      'Dear Sir/Madam,\n\n' +
      'I am writing to seek clarification on the following:\n' +
      '1. Product details and relevant product specifications\n' +
      '2. The applicable Indian Pharmacopoeia monograph or reference standard\n' +
      '3. Supporting analytical documentation\n\n' +
      'Regards,\nAbhinash Pritiraj',
    receivedAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

async function runTo(stopAt, { reviewers = [REVIEWER_A], message } = {}) {
  const { queryId } = s().ingestEmail(message || mailboxMessage());
  if (stopAt === WORKFLOW_STATE.RECEIVED) return queryId;

  s().verifyQuery(queryId, FRONT_OFFICE);
  if (stopAt === WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION) return queryId;

  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  if (stopAt === WORKFLOW_STATE.PENDING_ASSIGNMENT) return queryId;

  s().assignQuery(queryId, OFFICIAL.id, OIC);
  if (stopAt === WORKFLOW_STATE.ASSIGNED) return queryId;

  s().generateAiDraft(queryId, OFFICIAL);
  if (stopAt === WORKFLOW_STATE.DRAFTING) return queryId;

  for (const reviewer of reviewers) {
    s().addReviewLevel(queryId, reviewer.id, OFFICIAL);
  }
  s().submitForReview(queryId, OFFICIAL);
  if (stopAt === WORKFLOW_STATE.UNDER_REVIEW) return queryId;

  for (const reviewer of reviewers) {
    s().approveReview(queryId, `Approved by ${reviewer.name}`, reviewer);
  }
  if (stopAt === WORKFLOW_STATE.PENDING_FINAL_APPROVAL) return queryId;

  // Final approval now dispatches automatically. To observe the intermediate
  // READY_FOR_DISPATCH state — approved but not yet sent — approve with a
  // sender that fails, which is exactly what a Gmail outage looks like.
  if (stopAt === WORKFLOW_STATE.READY_FOR_DISPATCH) {
    await s()
      .grantFinalApproval(queryId, OIC, () => Promise.reject(new Error('Gmail unavailable')))
      .catch(() => {});
    return queryId;
  }

  await s().grantFinalApproval(queryId, OIC, fakeSend);
  return queryId;
}

const stateOf = (queryId) => s().getQuery(queryId).workflowState;

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('the complete lifecycle, end to end', () => {
  it('carries one email all the way to CLOSED', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    const query = s().getQuery(queryId);

    expect(queryId).toBe('QRY-2026-00001');
    expect(query.workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(query.businessStatus).toBe(BUSINESS_STATUS.CLOSED);
    expect(query.currentAssigneeId).toBe(OFFICIAL.id);
  });

  it('passes through every stage in order', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    const events = s()
      .getAudit(queryId)
      .map((a) => a.event);

    const backbone = [
      AUDIT_EVENT.QUERY_RECEIVED,
      AUDIT_EVENT.QUERY_REGISTERED,
      AUDIT_EVENT.QUERY_FORWARDED,
      AUDIT_EVENT.QUERY_ASSIGNED,
      AUDIT_EVENT.DRAFT_GENERATED,
      AUDIT_EVENT.REVIEW_COMPLETED,
      AUDIT_EVENT.FINAL_APPROVAL_GRANTED,
      AUDIT_EVENT.RESPONSE_DISPATCHED,
      AUDIT_EVENT.QUERY_CLOSED,
    ];

    let cursor = -1;
    for (const event of backbone) {
      const at = events.indexOf(event, cursor + 1);
      expect(at, `${event} must follow the previous stage`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('keeps the email ⇄ thread ⇄ query links intact end to end', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    const query = s().getQuery(queryId);
    const messages = s().emailMessages.filter((m) => m.queryId === queryId);

    // Enquiry in, forward to the OIC, final response out — one conversation.
    expect(messages.map((m) => m.emailType)).toEqual([
      EMAIL_TYPE.INCOMING_QUERY,
      EMAIL_TYPE.FORWARD,
      EMAIL_TYPE.OUTGOING_RESPONSE,
    ]);
    expect(new Set(messages.map((m) => m.threadId))).toEqual(new Set([query.threadId]));

    const thread = s().emailThreads.find((t) => t.threadId === query.threadId);
    expect(thread.queryId).toBe(queryId);

    const source = messages.find((m) => m.messageId === query.sourceEmailId);
    expect(source.sourceMessageId).toBe('MSG-00001');
    expect(source.direction).toBe(EMAIL_DIRECTION.INBOUND);
  });

  it('emails the approved response, quoting the query id', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    const response = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
    );
    const approved = s()
      .getVersions(queryId)
      .find((v) => v.status === RESPONSE_STATUS.FINAL_APPROVED);

    expect(response.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(response.to).toEqual(['abhinash.pritiraj@gmail.com']);
    expect(response.subject).toContain(queryId);
    expect(response.body).toBe(approved.content);
  });

  it('records one audit event per transition, appended in order', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    const audit = s().getAudit(queryId);

    expect(audit.length).toBeGreaterThanOrEqual(9);
    expect(audit.map((a) => a.auditId)).toEqual([...new Set(audit.map((a) => a.auditId))]);
    for (const entry of audit) {
      expect(entry.queryId).toBe(queryId);
      expect(entry.actor).toBeTruthy();
      expect(entry.at).toBeTruthy();
    }
  });

  it('survives a reload at the end — the whole case is persisted', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    await new Promise((r) => setTimeout(r, 60));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], workflowSteps: [], reviews: [], responseVersions: [],
      auditEvents: [], notifications: [], emailMessages: [], emailThreads: [],
    });
    await s().hydrate();

    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.CLOSED);
    expect(s().getVersions(queryId).length).toBeGreaterThan(0);
    expect(s().emailMessages.filter((m) => m.queryId === queryId)).toHaveLength(3);

    expect(s().ingestEmail(mailboxMessage()).created).toBe(false);
    expect(s().queries).toHaveLength(1);
  });
});

describe('dynamic review levels — nothing is hard-coded to two', () => {
  it.each([
    ['one level', [REVIEWER_A]],
    ['two levels', [REVIEWER_A, REVIEWER_B]],
    ['three levels', [REVIEWER_A, REVIEWER_B, REVIEWER_A]],
  ])('completes with %s', async (_label, reviewers) => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED, { reviewers });

    const reviewSteps = s()
      .getSteps(queryId)
      .filter((step) => step.stepType === 'REVIEW');
    expect(reviewSteps).toHaveLength(reviewers.length);
    expect(reviewSteps.every((step) => step.status === 'COMPLETED')).toBe(true);
    expect(s().getReviews(queryId)).toHaveLength(reviewers.length);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.CLOSED);
  });

  it('goes straight to final approval when no review level was added', async () => {
    const queryId = await runTo(WORKFLOW_STATE.DRAFTING);
    s().submitForReview(queryId, OFFICIAL);

    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
    expect(s().getSteps(queryId).filter((step) => step.stepType === 'REVIEW')).toHaveLength(0);
  });

  it('holds at the first level until it is approved', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW, {
      reviewers: [REVIEWER_A, REVIEWER_B],
    });

    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);

    s().approveReview(queryId, 'Level 2 fine', REVIEWER_B);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
  });
});

describe('revision cycles', () => {
  it('returns to the official, then re-enters review', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);

    s().requestRevision(queryId, 'Please cite the monograph edition.', REVIEWER_A);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.RETURNED_FOR_REVISION);

    s().saveDraftVersion(queryId, 'Revised text citing IP 2022.', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);

    s().approveReview(queryId, 'Now correct.', REVIEWER_A);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
  });

  it('survives several revision rounds, retaining every version', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);

    for (let round = 1; round <= 3; round += 1) {
      s().requestRevision(queryId, `Round ${round}`, REVIEWER_A);
      s().saveDraftVersion(queryId, `Revision ${round}`, OFFICIAL, 'Revision after review');
      s().submitForReview(queryId, OFFICIAL);
    }
    s().approveReview(queryId, 'Finally.', REVIEWER_A);

    const versions = s().getVersions(queryId);
    expect(versions.map((v) => v.version)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(versions[0].source).toBe(RESPONSE_SOURCE.AI_GENERATED);
    expect(versions.slice(1).every((v) => v.source === RESPONSE_SOURCE.REVIEW_REVISION)).toBe(true);
  });

  it('lets the OIC return a case, restarting the whole review cycle', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_FINAL_APPROVAL, {
      reviewers: [REVIEWER_A, REVIEWER_B],
    });

    s().returnForRevisionFromApproval(queryId, 'Tone needs softening.', OIC);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.RETURNED_FOR_REVISION);

    s().saveDraftVersion(queryId, 'Softened text.', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    // The revised draft must climb the whole ladder again: Reviewer-I first,
    // not straight back to the OIC.
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);

    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);

    s().approveReview(queryId, 'Level 2 fine', REVIEWER_B);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);

    await s().grantFinalApproval(queryId, OIC, fakeSend);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.CLOSED);
  });
});

describe('response versioning and locking', () => {
  it('retains every version and marks only the approved one', async () => {
    const queryId = await runTo(WORKFLOW_STATE.DRAFTING);
    s().saveDraftVersion(queryId, 'Officer edit A', OFFICIAL);
    s().saveDraftVersion(queryId, 'Officer edit B', OFFICIAL);
    s().submitForReview(queryId, OFFICIAL);
    await s().grantFinalApproval(queryId, OIC, fakeSend);

    const versions = s().getVersions(queryId);
    expect(versions).toHaveLength(3);
    expect(versions.filter((v) => v.status === RESPONSE_STATUS.FINAL_APPROVED)).toHaveLength(1);
    expect(versions.at(-1).status).toBe(RESPONSE_STATUS.FINAL_APPROVED);
    expect(versions.at(-1).approvedAt).toBeTruthy();
    expect(versions[0].content).toContain('AI-GENERATED FIRST DRAFT');
    expect(versions[1].content).toBe('Officer edit A');
  });

  it('refuses to edit a response locked by final approval', async () => {
    const queryId = await runTo(WORKFLOW_STATE.READY_FOR_DISPATCH);

    useWorkflowStore.setState({
      queries: s().queries.map((q) =>
        q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.DRAFTING } : q,
      ),
    });

    expect(() => s().saveDraftVersion(queryId, 'Sneaky edit', OFFICIAL)).toThrow(/locked/i);
    expect(s().getVersions(queryId).some((v) => v.content === 'Sneaky edit')).toBe(false);
  });

  it('dispatches exactly the approved text', async () => {
    const queryId = await runTo(WORKFLOW_STATE.DRAFTING);
    s().saveDraftVersion(queryId, 'The final agreed wording.', OFFICIAL);
    s().submitForReview(queryId, OFFICIAL);
    // No manual dispatch: approval sends the approved text on its own.
    await s().grantFinalApproval(queryId, OIC, fakeSend);

    const sent = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE);
    expect(sent.body).toBe('The final agreed wording.');
  });
});

describe('AI is derived from the query, never a fixed template', () => {
  it('summarises two different enquiries differently', () => {
    const first = s().ingestEmail(mailboxMessage()).queryId;
    const second = s().ingestEmail(
      mailboxMessage({
        mailboxMessageId: 'MSG-00002',
        subject: 'Training workshop registration',
        body: 'Please confirm the training workshop dates and the registration procedure.',
      }),
    ).queryId;

    const a = s().getQuery(first).aiSummary;
    const b = s().getQuery(second).aiSummary;

    expect(a.text).not.toBe(b.text);
    expect(a.topics).toContain('monograph');
    expect(b.topics).toContain('training');
    expect(a.keyPoints.length).toBeGreaterThan(0);
  });

  it('drafts different responses for different enquiries', async () => {
    const first = await runTo(WORKFLOW_STATE.DRAFTING);
    const second = await runTo(WORKFLOW_STATE.DRAFTING, {
      message: mailboxMessage({
        mailboxMessageId: 'MSG-00002',
        subject: 'Certificate reissue request',
        body: 'Please advise on the payment process for a certificate reissue.',
      }),
    });

    const draftA = s().getLatestVersion(first).content;
    const draftB = s().getLatestVersion(second).content;

    expect(draftA).not.toBe(draftB);
    expect(draftA).toContain(first);
    expect(draftB).toContain(second);
    expect(draftA).toContain('AI-GENERATED FIRST DRAFT');
  });

  it('recommends an assignee and records it before the human decides', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    const recommendation = s().recommendAssigneeFor(queryId);

    expect(recommendation.userId).toBeTruthy();
    expect(recommendation.matchPercent).toBeGreaterThan(0);
    expect(recommendation.reason).toBeTruthy();

    s().assignQuery(queryId, OFFICIAL.id, OIC);
    const events = s().getAudit(queryId).map((a) => a.event);
    expect(events.indexOf(AUDIT_EVENT.AI_ASSIGNMENT_RECOMMENDED)).toBeLessThan(
      events.indexOf(AUDIT_EVENT.QUERY_ASSIGNED),
    );
  });

  it('records an override when the OIC picks someone else', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    const recommendation = s().recommendAssigneeFor(queryId);
    const other = [OFFICIAL].find((u) => u.id !== recommendation.userId) || OFFICIAL;

    s().assignQuery(queryId, other.id, OIC);

    const overrides = s()
      .getAudit(queryId)
      .filter((a) => a.event === AUDIT_EVENT.ASSIGNMENT_OVERRIDDEN);
    expect(overrides).toHaveLength(recommendation.userId === other.id ? 0 : 1);
    expect(s().getQuery(queryId).assignmentDecision.acceptedAiRecommendation).toBe(
      recommendation.userId === other.id,
    );
  });
});

describe('invalid transitions are refused centrally', () => {
  it('cannot dispatch before final approval', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);
    await expect(s().dispatchResponse(queryId, FRONT_OFFICE, fakeSend)).rejects.toThrow(
      /may not perform DISPATCH/,
    );
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);
  });

  it('cannot approve a review before the draft is submitted', async () => {
    const queryId = await runTo(WORKFLOW_STATE.DRAFTING);
    expect(() => s().approveReview(queryId, 'too early', REVIEWER_A)).toThrow(
      /may not perform APPROVE_REVIEW/,
    );
  });

  it('cannot assign before the query has been forwarded', async () => {
    const queryId = await runTo(WORKFLOW_STATE.RECEIVED);
    expect(() => s().assignQuery(queryId, OFFICIAL.id, OIC)).toThrow(/may not perform ASSIGN/);
  });

  it('cannot verify a query twice', async () => {
    const queryId = await runTo(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(() => s().verifyQuery(queryId, FRONT_OFFICE)).toThrow(/may not perform VERIFY/);
  });

  it('cannot act on a closed query', async () => {
    const queryId = await runTo(WORKFLOW_STATE.CLOSED);
    expect(() => s().verifyQuery(queryId, FRONT_OFFICE)).toThrow();
    expect(() => s().saveDraftVersion(queryId, 'after close', OFFICIAL)).toThrow();
    await expect(s().dispatchResponse(queryId, FRONT_OFFICE, fakeSend)).rejects.toThrow();
  });

  it('cannot act on a query that does not exist', () => {
    expect(() => s().verifyQuery('QRY-2026-99999', FRONT_OFFICE)).toThrow(/does not exist/);
  });

  it('a refused action writes nothing — no state change, no audit row', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);
    const before = {
      state: stateOf(queryId),
      audit: s().getAudit(queryId).length,
      versions: s().getVersions(queryId).length,
      counters: { ...s().counters },
    };

    expect(() => s().verifyQuery(queryId, FRONT_OFFICE)).toThrow();
    await expect(s().dispatchResponse(queryId, FRONT_OFFICE, fakeSend)).rejects.toThrow();

    expect(stateOf(queryId)).toBe(before.state);
    expect(s().getAudit(queryId)).toHaveLength(before.audit);
    expect(s().getVersions(queryId)).toHaveLength(before.versions);
    expect(s().counters).toEqual(before.counters);
  });
});

describe('RBAC — the wrong role is refused even at the right stage', () => {
  const OTHERS = [
    ['the inquirer', INQUIRER],
    ['an admin', ADMIN],
    ['a reviewer', REVIEWER_A],
    ['the assigned official', OFFICIAL],
    ['front office', FRONT_OFFICE],
    ['the officer-in-charge', OIC],
  ];

  const STAGES = [
    [WORKFLOW_STATE.RECEIVED, WORKFLOW_ACTION.VERIFY, ROLES.FRONT_OFFICE],
    [WORKFLOW_STATE.PENDING_ASSIGNMENT, WORKFLOW_ACTION.ASSIGN, ROLES.OFFICER_IN_CHARGE],
    [WORKFLOW_STATE.DRAFTING, WORKFLOW_ACTION.SUBMIT_FOR_REVIEW, ROLES.ASSIGNED_OFFICIAL],
    [WORKFLOW_STATE.UNDER_REVIEW, WORKFLOW_ACTION.APPROVE_REVIEW, ROLES.REVIEWER],
    [WORKFLOW_STATE.PENDING_FINAL_APPROVAL, WORKFLOW_ACTION.FINAL_APPROVE, ROLES.OFFICER_IN_CHARGE],
    [WORKFLOW_STATE.READY_FOR_DISPATCH, WORKFLOW_ACTION.DISPATCH, ROLES.FRONT_OFFICE],
  ];

  const CALL = {
    [WORKFLOW_ACTION.VERIFY]: (id, actor) => s().verifyQuery(id, actor),
    [WORKFLOW_ACTION.ASSIGN]: (id, actor) => s().assignQuery(id, OFFICIAL.id, actor),
    [WORKFLOW_ACTION.SUBMIT_FOR_REVIEW]: (id, actor) => s().submitForReview(id, actor),
    [WORKFLOW_ACTION.APPROVE_REVIEW]: (id, actor) => s().approveReview(id, 'ok', actor),
    [WORKFLOW_ACTION.FINAL_APPROVE]: (id, actor) => s().grantFinalApproval(id, actor),
    [WORKFLOW_ACTION.DISPATCH]: (id, actor) => s().dispatchResponse(id, actor, fakeSend),
  };

  const cases = STAGES.flatMap(([state, action, allowedRole]) =>
    OTHERS.filter(([, user]) => user.role !== allowedRole).map(([label, user]) => [
      `${action} at ${state} is refused for ${label}`,
      state,
      action,
      user,
    ]),
  );

  it.each(cases)('%s', async (_label, state, action, user) => {
    const queryId = await runTo(state);
    await expect(async () => CALL[action](queryId, user)).rejects.toThrow(
      new RegExp(`may not perform ${action}`),
    );
    expect(stateOf(queryId)).toBe(state);
  });

  it('the inquirer can do nothing at all to a case', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
    await expect(s().grantFinalApproval(queryId, INQUIRER)).rejects.toThrow();
    expect(() => s().approveReview(queryId, 'ok', INQUIRER)).toThrow();
    expect(() => s().saveDraftVersion(queryId, 'text', INQUIRER)).toThrow();
  });

  it('a missing actor is refused, not treated as a system action', async () => {
    const queryId = await runTo(WORKFLOW_STATE.RECEIVED);
    expect(() => s().verifyQuery(queryId, null)).toThrow(/unauthenticated/i);
  });
});

describe('the original enquiry is immutable', () => {
  it('is not modified by anything the workflow does', async () => {
    const queryId = await runTo(WORKFLOW_STATE.RECEIVED);
    const before = { ...s().emailMessages.find((m) => m.queryId === queryId) };

    await runTo(WORKFLOW_STATE.CLOSED, { message: mailboxMessage({ mailboxMessageId: 'MSG-00002' }) });
    s().verifyQuery(queryId, FRONT_OFFICE);

    const after = s().emailMessages.find((m) => m.messageId === before.messageId);
    expect(after).toEqual(before);
  });
});

describe('duplicate ingestion protection still holds', () => {
  it('re-ingesting mid-workflow does not create or reset a case', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);

    const replay = s().ingestEmail(mailboxMessage());

    expect(replay).toMatchObject({ queryId, created: false, reason: 'already-ingested' });
    expect(s().queries).toHaveLength(1);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);
  });
});

describe('every revision restarts at Reviewer-I', () => {
  /** Reach UNDER_REVIEW with two reviewers configured. */
  async function twoLevelReview() {
    return runTo(WORKFLOW_STATE.UNDER_REVIEW, { reviewers: [REVIEWER_A, REVIEWER_B] });
  }

  const pendingReviewer = (queryId) => {
    const step = s().getCurrentStep(queryId);
    return step?.assignedUserId;
  };

  it('a Reviewer-II rejection sends the revision back to Reviewer-I, not Reviewer-II', async () => {
    const queryId = await twoLevelReview();

    s().approveReview(queryId, 'Level 1 fine', REVIEWER_A);
    expect(pendingReviewer(queryId)).toBe(REVIEWER_B.id);

    // Reviewer-II rejects. Previously the revision went straight back to
    // Reviewer-II, skipping Reviewer-I entirely.
    s().requestRevision(queryId, 'Cite the edition.', REVIEWER_B);
    s().saveDraftVersion(queryId, 'Revised text.', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    expect(pendingReviewer(queryId)).toBe(REVIEWER_A.id);

    // And the full ladder still has to be climbed.
    s().approveReview(queryId, 'ok', REVIEWER_A);
    expect(pendingReviewer(queryId)).toBe(REVIEWER_B.id);
    s().approveReview(queryId, 'ok', REVIEWER_B);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
  });

  it('a Reviewer-I rejection also re-enters at Reviewer-I', async () => {
    const queryId = await twoLevelReview();

    s().requestRevision(queryId, 'Needs the monograph reference.', REVIEWER_A);
    s().saveDraftVersion(queryId, 'Revised.', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    expect(pendingReviewer(queryId)).toBe(REVIEWER_A.id);
  });

  it('an OIC return re-enters at Reviewer-I and must pass both levels again', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_FINAL_APPROVAL, {
      reviewers: [REVIEWER_A, REVIEWER_B],
    });

    s().returnForRevisionFromApproval(queryId, 'Soften the tone.', OIC);
    s().saveDraftVersion(queryId, 'Softened.', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    expect(pendingReviewer(queryId)).toBe(REVIEWER_A.id);

    s().approveReview(queryId, 'ok', REVIEWER_A);
    expect(pendingReviewer(queryId)).toBe(REVIEWER_B.id);
  });

  it('survives several loops, retaining every version', async () => {
    const queryId = await twoLevelReview();

    // Reviewer-I rejects, Reviewer-II rejects, OIC returns — three full laps.
    s().requestRevision(queryId, 'Round 1', REVIEWER_A);
    s().saveDraftVersion(queryId, 'v2 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().requestRevision(queryId, 'Round 2', REVIEWER_B);
    s().saveDraftVersion(queryId, 'v3 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().approveReview(queryId, 'ok', REVIEWER_B);
    s().returnForRevisionFromApproval(queryId, 'Round 3', OIC);
    s().saveDraftVersion(queryId, 'v4 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);

    s().approveReview(queryId, 'ok', REVIEWER_A);
    s().approveReview(queryId, 'ok', REVIEWER_B);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);

    expect(s().getVersions(queryId).map((v) => v.version)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(s().queries).toHaveLength(1);
  });
});

describe('review comments', () => {
  it('are bound to the version that was reviewed', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);

    s().requestRevision(queryId, 'Fix the citation.', REVIEWER_A);
    s().saveDraftVersion(queryId, 'v2 text', OFFICIAL, 'Revision after review');
    s().submitForReview(queryId, OFFICIAL);
    s().approveReview(queryId, 'Now correct.', REVIEWER_A);

    const [rejection, approval] = s().getReviews(queryId);

    expect(rejection).toMatchObject({
      decision: 'CHANGES_REQUESTED',
      comment: 'Fix the citation.',
      version: 'v1',
      reviewerId: REVIEWER_A.id,
    });
    expect(approval).toMatchObject({ decision: 'APPROVED', version: 'v2' });
  });

  it('record the OIC return against the version it rejected', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
    s().returnForRevisionFromApproval(queryId, 'Needs a softer tone.', OIC);

    const oicReturn = s().getReviews(queryId).at(-1);
    expect(oicReturn).toMatchObject({
      decision: 'CHANGES_REQUESTED',
      comment: 'Needs a softer tone.',
      version: 'v1',
      reviewerId: OIC.id,
    });
  });

  it('are mandatory when changes are requested', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);

    expect(() => s().requestRevision(queryId, '', REVIEWER_A)).toThrow(/requires a comment/);
    expect(() => s().requestRevision(queryId, '   ', REVIEWER_A)).toThrow(/requires a comment/);
    expect(() => s().requestRevision(queryId, undefined, REVIEWER_A)).toThrow(/requires a comment/);

    // Nothing was recorded and the case did not move.
    expect(s().getReviews(queryId)).toHaveLength(0);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.UNDER_REVIEW);
  });

  it('are mandatory when the OIC returns for revision', async () => {
    const queryId = await runTo(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);

    expect(() => s().returnForRevisionFromApproval(queryId, '', OIC)).toThrow(/requires a comment/);
    expect(stateOf(queryId)).toBe(WORKFLOW_STATE.PENDING_FINAL_APPROVAL);
  });

  it('stay optional on approval', async () => {
    const queryId = await runTo(WORKFLOW_STATE.UNDER_REVIEW);
    expect(() => s().approveReview(queryId, '', REVIEWER_A)).not.toThrow();
  });
});
