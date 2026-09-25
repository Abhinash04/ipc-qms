import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { AUDIT_EVENT, RESPONSE_STATUS, WORKFLOW_STATE } from '@/constants/statusEnums';
import * as queryCaseService from '@/services/api/queryCaseService';
import { notify } from '@/services/notify';
import { persistTransitionSchema } from '../../../backend/src/validators/queryStateSchemas.js';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');
const ADMIN = findUserById('USR-0007');

const KNOWN_EVENTS = new Set(Object.values(AUDIT_EVENT));

const captured = [];

function assertEveryDeltaParses() {
  for (const delta of captured) {
    const onTheWire = JSON.parse(JSON.stringify(delta));
    const result = persistTransitionSchema.safeParse(onTheWire);

    const issues = result.success
      ? ''
      : result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('\n  ');

    expect(
      result.success,
      `${delta.auditEvent?.event} would be rejected with 400:\n  ${issues}`,
    ).toBe(true);
  }
}

vi.mock('@/services/api/queryCaseService', () => ({
  fetchAllQueries: vi.fn(async () => ({ queries: [] })),
  checkQueriesEmpty: vi.fn(async () => true),
  resetQueries: vi.fn(async () => ({ success: true })),
  grantFinalApproval: vi.fn(async (queryId) => ({ queryId, approved: true })),
  persistQueryTransition: vi.fn(async (delta) => {
    captured.push(delta);
    return { success: true };
  }),
}));

const enquiry = () => ({
  mailboxMessageId: 'msg-contract-1',
  providerMessageId: 'msg-contract-1',
  providerThreadId: 'thread-contract-1',
  to: 'front-office@test.invalid',
  from: 'A Member of the Public <someone@example.com>',
  subject: 'Clarification on dissolution limits',
  body: 'Please clarify.',
  receivedAt: '2026-09-17T09:00:00.000Z',
  attachments: [],
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeForward = async ({ queryId }) => {
  await settled();
  useWorkflowStore.setState((state) => ({
    queries: state.queries.map((q) =>
      q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT } : q,
    ),
  }));
  return { queryId, emailType: 'FORWARD', outcome: 'SENT' };
};

async function caseAwaitingReview() {
  const { queryId } = s().ingestEmail(enquiry(), async () => null);
  await s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
  await settled();
  return queryId;
}

const serverSnapshot = (overrides = {}) => {
  const state = s();
  return {
    queries: state.queries,
    workflowSteps: state.workflowSteps,
    reviews: state.reviews,
    responseVersions: state.responseVersions,
    auditEvents: state.auditEvents,
    notifications: state.notifications,
    emailMessages: state.emailMessages,
    emailThreads: state.emailThreads,
    counters: state.counters,
    ...overrides,
  };
};

beforeEach(async () => {
  captured.length = 0;
  vi.clearAllMocks();
  queryCaseService.persistQueryTransition.mockImplementation(async (delta) => {
    captured.push(delta);
    return { success: true };
  });
  queryCaseService.fetchAllQueries.mockImplementation(async () => serverSnapshot());
  useWorkflowStore.setState({ ...useWorkflowStore.getState(), hydrated: false });
  await s().hydrate();
});

describe('the delta the store sends to POST /queries/persist', () => {
  it('sends audit details as a STRING — the shape that used to 400', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await settled();

    const withDetails = captured.filter((d) => d.auditEvent?.details != null);
    expect(withDetails.length).toBeGreaterThan(0);

    for (const delta of withDetails) {
      expect(typeof delta.auditEvent.details).toBe('string');
    }

    expect(
      withDetails.some((d) =>
        d.auditEvent.details.includes('Front Office verified the query details'),
      ),
    ).toBe(true);
  });

  it('carries the fields that link a case back to its email', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await settled();

    const query = captured.map((d) => d.query).find((q) => q?.queryId === queryId);
    expect(query).toBeDefined();

    expect(query.threadId).toEqual(expect.any(String));
    expect(query.sourceMailboxMessageId).toBe('msg-contract-1');
    expect(query.sourceEmailId).toEqual(expect.any(String));
  });

  it('sends counters as a flat map of numbers', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await settled();

    const counters = captured.map((d) => d.counters).filter(Boolean).at(-1);
    expect(counters).toBeDefined();
    for (const [prefix, value] of Object.entries(counters)) {
      expect(typeof value, `counters.${prefix}`).toBe('number');
    }
    expect(counters.QRY).toBeGreaterThan(0);
  });

  it('sends the inbound email with the id the duplicate guard keys on', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await settled();

    const message = captured
      .flatMap((d) => d.addMessages || [])
      .find((m) => m.queryId === queryId);

    expect(message).toBeDefined();
    expect(message.sourceMessageId).toBe('msg-contract-1');
    expect(message.providerThreadId).toBe('thread-contract-1');
  });
});

describe('every transition names its audit event', () => {
  it('refuses a transition that omits one, rather than sending event: undefined', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await settled();
    captured.length = 0;

    const withNoEvent = () =>
      s().applyTransition({
        queryId,
        actor: null,
        actorLabel: 'AI Summary Assistant',
        patch: { aiSummary: { text: 'Regenerated summary.' } },
        details: 'Regenerated summary.',
      });

    expect(withNoEvent).toThrow(/must name an audit event/);
    expect(withNoEvent).toThrow(queryId);
    expect(withNoEvent).toThrow('AUDIT_EVENT');

    await settled();
    expect(captured).toEqual([]);
    expect(s().getQuery(queryId).aiSummary.text).not.toBe('Regenerated summary.');
  });

  it('names a known one on every delta a whole case emits', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'Reads correctly against the monograph.', REVIEWER);
    s().rejectFinalApproval(queryId, 'Cites the superseded revision.', OIC);
    s().transferQuery(queryId, 'USR-0010', 'Monograph expertise sits elsewhere.', OFFICIAL);
    s().pullBackQuery(queryId, WORKFLOW_STATE.PENDING_ASSIGNMENT, 'Reassigning the case.', '', ADMIN);
    await settled();

    expect(captured.length).toBeGreaterThan(10);

    for (const delta of captured) {
      const event = delta.auditEvent?.event;
      expect(typeof event, `auditEvent: ${JSON.stringify(delta.auditEvent)}`).toBe('string');
      expect(event.length).toBeGreaterThan(0);
      expect(KNOWN_EVENTS.has(event), `unknown audit event ${event}`).toBe(true);
    }

    expect(captured.map((d) => d.auditEvent.event)).toEqual(
      expect.arrayContaining([
        AUDIT_EVENT.QUERY_RECEIVED,
        AUDIT_EVENT.QUERY_REGISTERED,
        AUDIT_EVENT.QUERY_ASSIGNED,
        AUDIT_EVENT.DRAFT_GENERATED,
        AUDIT_EVENT.REVIEW_ADDED,
        AUDIT_EVENT.REVIEW_COMPLETED,
        AUDIT_EVENT.FINAL_APPROVAL_REJECTED,
        AUDIT_EVENT.QUERY_TRANSFERRED,
        AUDIT_EVENT.QUERY_PULLED_BACK,
      ]),
    );
  });

  it('carries the minted auditId, and never the same one twice', async () => {
    const queryId = await caseAwaitingReview();
    s().requestRevision(queryId, 'Cite the 2022 revision, not the 2018 one.', REVIEWER);
    await settled();

    const ids = captured.map((d) => d.auditEvent?.auditId);
    expect(ids.length).toBeGreaterThan(5);

    for (const auditId of ids) {
      expect(typeof auditId).toBe('string');
      expect(auditId.length).toBeGreaterThan(0);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a review delta keeps the words the reviewer wrote', () => {
  const reviewOnTheWire = () => captured.find((d) => d.addReviews?.length)?.addReviews?.[0];

  it('sends approveReview with the comment and the version it approved', async () => {
    const queryId = await caseAwaitingReview();
    captured.length = 0;

    s().approveReview(queryId, 'Cites the right monograph.', REVIEWER);
    await settled();

    const review = reviewOnTheWire();
    expect(review).toBeDefined();
    expect(review.comment).toBe('Cites the right monograph.');
    expect(review.responseId).toEqual(expect.any(String));
    expect(review.version).toBe('v1');
    expect(review.stepId).toEqual(expect.any(String));
    expect(review.decision).toBe('APPROVED');
  });

  it('sends requestRevision with the comment that says what must change', async () => {
    const queryId = await caseAwaitingReview();
    captured.length = 0;

    s().requestRevision(queryId, 'Add the dissolution limits table.', REVIEWER);
    await settled();

    const review = reviewOnTheWire();
    expect(review).toBeDefined();
    expect(review.comment).toBe('Add the dissolution limits table.');
    expect(review.responseId).toEqual(expect.any(String));
    expect(review.version).toBe('v1');
    expect(review.stepId).toEqual(expect.any(String));
    expect(review.decision).toBe('CHANGES_REQUESTED');
  });

  it('sends returnForRevisionFromApproval with a null stepId — the shape that 400ed', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'No objection from review.', REVIEWER);
    await settled();
    captured.length = 0;

    s().returnForRevisionFromApproval(queryId, 'Spell the citation out in full.', OIC);
    await settled();

    const review = reviewOnTheWire();
    expect(review).toBeDefined();
    expect(review.comment).toBe('Spell the citation out in full.');
    expect(review.responseId).toEqual(expect.any(String));
    expect(review.version).toBe('v1');

    expect(review.stepId).toBeNull();
  });
});

describe('the final-approval lock survives the trip', () => {
  it('puts the whole version row on the wire, status included', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE, fakeForward);
    s().assignQuery(queryId, OFFICIAL.id, OIC);
    await settled();
    captured.length = 0;

    await s().generateAiDraft(queryId, OFFICIAL);
    s().saveDraftVersion(queryId, 'Officer rewrite of the AI draft.', OFFICIAL);
    await settled();

    const versions = captured.flatMap((d) => [
      ...(d.upsertVersions || []),
      ...(d.addVersions || []),
    ]);
    expect(versions).toHaveLength(2);

    for (const version of versions) {
      expect(version.responseId).toEqual(expect.any(String));
      expect(version.queryId).toBe(queryId);
      expect(version.version).toMatch(/^v\d+$/);
      expect(version.content.length).toBeGreaterThan(0);
      expect(version.status).toBe(RESPONSE_STATUS.DRAFT);
    }
  });

  it('keeps the FINAL_APPROVED status a reload brings back', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'No objection from review.', REVIEWER);
    await settled();

    const approved = s().getLatestVersion(queryId);
    expect(approved.status).toBe(RESPONSE_STATUS.DRAFT);

    queryCaseService.fetchAllQueries.mockResolvedValueOnce(
      serverSnapshot({
        responseVersions: s().responseVersions.map((v) =>
          v.responseId === approved.responseId
            ? { ...v, status: RESPONSE_STATUS.FINAL_APPROVED, approvedAt: '2026-09-17T12:00:00.000Z' }
            : v,
        ),
      }),
    );

    expect(await s().refreshFromServer()).toBe(true);

    const locked = s()
      .getVersions(queryId)
      .find((v) => v.responseId === approved.responseId);
    expect(locked).toBeDefined();
    expect(locked.status).toBe(RESPONSE_STATUS.FINAL_APPROVED);
    expect(locked.version).toBe(approved.version);
  });

  it('hands final approval to the server for the right case, and writes nothing itself', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'No objection from review.', REVIEWER);
    await settled();
    captured.length = 0;

    const approveEndpoint = vi.fn(async (id) => ({
      queryId: id,
      approved: true,
      dispatched: true,
      alreadyDispatched: false,
      workflowState: WORKFLOW_STATE.CLOSED,
      recipient: 'someone@example.com',
      errors: [],
    }));

    queryCaseService.fetchAllQueries.mockResolvedValueOnce(
      serverSnapshot({
        queries: s().queries.map((q) =>
          q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.CLOSED } : q,
        ),
      }),
    );

    const outcome = await s().grantFinalApproval(queryId, OIC, approveEndpoint);

    expect(approveEndpoint).toHaveBeenCalledTimes(1);
    expect(approveEndpoint.mock.calls[0][0]).toBe(queryId);
    expect(outcome.dispatched).toBe(true);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);

    await settled();
    expect(captured).toEqual([]);
  });
});

describe('a server action reads the case back even when it fails', () => {
  const unavailable = () =>
    vi.fn(async () => {
      throw Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });
    });

  it('reloads after final approval fails', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'No objection from review.', REVIEWER);
    await settled();

    queryCaseService.fetchAllQueries.mockResolvedValueOnce(
      serverSnapshot({
        queries: s().queries.map((q) =>
          q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.READY_FOR_DISPATCH } : q,
        ),
      }),
    );

    await expect(s().grantFinalApproval(queryId, OIC, unavailable())).rejects.toThrow(/503/);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.READY_FOR_DISPATCH);
  });

  it('reloads after recording an outbound email fails', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await settled();

    queryCaseService.fetchAllQueries.mockResolvedValueOnce(
      serverSnapshot({
        outboundEmails: [{ queryId, emailType: 'OUTGOING_RESPONSE', status: 'SENT' }],
      }),
    );

    await expect(
      s().resolveOutboundEmail(queryId, { emailType: 'OUTGOING_RESPONSE', outcome: 'SENT' }, unavailable()),
    ).rejects.toThrow(/503/);

    expect(s().getOutbound(queryId, 'OUTGOING_RESPONSE')?.status).toBe('SENT');
  });
});

describe('the server would accept every delta the store emits', () => {
  it('parses a whole case, from arrival to the reviewer approving', async () => {
    const queryId = await caseAwaitingReview();

    s().approveReview(queryId, '', REVIEWER);
    await settled();

    expect(captured.length).toBeGreaterThan(5);
    assertEveryDeltaParses();
  });

  it('parses a reviewer asking for changes', async () => {
    const queryId = await caseAwaitingReview();
    s().requestRevision(queryId, 'Tighten the second paragraph.', REVIEWER);
    await settled();

    assertEveryDeltaParses();
  });

  it('parses a review raised from final approval, which belongs to no step', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'Reads correctly.', REVIEWER);
    s().returnForRevisionFromApproval(queryId, 'Cite the current revision.', OIC);
    await settled();

    expect(captured.some((d) => d.addReviews?.some((r) => r.stepId === null))).toBe(true);
    assertEveryDeltaParses();
  });

  it('parses rejection, transfer and pullback', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'Reads correctly against the monograph.', REVIEWER);
    s().rejectFinalApproval(queryId, 'Cites the superseded revision.', OIC);
    s().transferQuery(queryId, 'USR-0010', 'Expertise sits elsewhere.', OFFICIAL);
    s().pullBackQuery(queryId, WORKFLOW_STATE.PENDING_ASSIGNMENT, 'Reassigning.', '', ADMIN);
    await settled();

    assertEveryDeltaParses();
  });
});

describe('a write built on an outdated case', () => {
  const conflict = (code, queryId) =>
    Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { code, queryId } },
    });

  const teammateMovesOn = (queryId) => {
    const saved = JSON.parse(
      JSON.stringify(
        serverSnapshot({
          queries: s().queries.map((q) =>
            q.queryId === queryId
              ? { ...q, revision: 40, workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT }
              : q,
          ),
        }),
      ),
    );
    queryCaseService.fetchAllQueries.mockImplementation(async () => JSON.parse(JSON.stringify(saved)));
  };

  const summarise = (queryId, text) =>
    s().applyTransition({
      queryId,
      actor: null,
      actorLabel: 'AI Summary Assistant',
      event: AUDIT_EVENT.AI_SUMMARY_GENERATED,
      patch: { aiSummary: { text } },
      details: text,
    });

  it('sends each change on the revision the one before it left', async () => {
    const queryId = await caseAwaitingReview();

    const sent = captured.filter((d) => d.query?.queryId === queryId);
    expect(sent.length).toBeGreaterThan(3);
    expect(sent.map((d) => d.baseRevision)).toEqual(sent.map((_, index) => index));
    expect(s().getQuery(queryId).revision).toBe(sent.length);
  });

  it.each([
    ['STALE_CASE', 'was changed by someone else', /redo your last step/],
    ['ID_COLLISION', "clashed with a teammate's change", /please retry/],
  ])('reloads the case and explains a %s refusal exactly once', async (code, title, detail) => {
    const queryId = await caseAwaitingReview();
    const failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
    queryCaseService.persistQueryTransition.mockRejectedValueOnce(conflict(code, queryId));
    teammateMovesOn(queryId);

    s().approveReview(queryId, 'Reads correctly.', REVIEWER);

    await vi.waitFor(() => {
      expect(s().getQuery(queryId).revision).toBe(40);
    });
    await settled();

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(`${queryId} ${title}`, expect.stringMatching(detail), {
      id: `case-conflict-${queryId}`,
    });
    failed.mockRestore();
  });

  it('never sends a change built on the refused one, and builds the next on the saved revision', async () => {
    const queryId = await caseAwaitingReview();
    const failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
    queryCaseService.persistQueryTransition.mockClear();
    queryCaseService.persistQueryTransition.mockRejectedValueOnce(conflict('STALE_CASE', queryId));
    teammateMovesOn(queryId);
    captured.length = 0;

    summarise(queryId, 'First summary.');
    summarise(queryId, 'Second summary.');

    await vi.waitFor(() => {
      expect(s().getQuery(queryId).revision).toBe(40);
    });
    await settled();

    expect(queryCaseService.persistQueryTransition).toHaveBeenCalledTimes(1);
    expect(captured).toEqual([]);
    expect(failed).toHaveBeenCalledTimes(1);

    summarise(queryId, 'Third summary.');
    await settled();

    expect(captured.map((d) => d.baseRevision)).toEqual([40]);
    expect(captured[0].query.aiSummary.text).toBe('Third summary.');
    failed.mockRestore();
  });

  it('lets its own queued write land before a server action moves the revision', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await settled();
    let release;
    queryCaseService.persistQueryTransition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true });
        }),
    );
    const forward = vi.fn(fakeForward);

    summarise(queryId, 'Summary written before the forward.');
    const forwarding = s().forwardToOic(queryId, FRONT_OFFICE, forward);
    await settled();

    expect(forward).not.toHaveBeenCalled();

    release();
    await forwarding;

    expect(forward).toHaveBeenCalledTimes(1);
  });
});
