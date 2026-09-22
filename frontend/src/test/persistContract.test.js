import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT, RESPONSE_STATUS, WORKFLOW_STATE } from '@/constants/statusEnums';
import * as queryCaseService from '@/services/api/queryCaseService';
// The server's own schema, imported rather than restated. A second copy of the
// contract here would drift from the one Express actually enforces, and a
// contract test that can drift is the thing it is supposed to prevent.
import { persistTransitionSchema } from '../../../backend/src/validators/queryStateSchemas.js';

vi.mock('@/services/api/mailboxService');

/**
 * What the store actually puts on the wire.
 *
 * This exists because of a real data-loss incident: the backend's Zod schema
 * typed `auditEvent.details` as an object, because that is how the Mongoose
 * model declares it. The client sends a human-readable **string**. Every
 * `POST /queries/persist` therefore returned 400 and nothing the Front Office
 * did was ever persisted — cases, emails and workflow steps all lived only in
 * browser memory until the tab closed.
 *
 * The bug survived a round of endpoint testing because that testing used a
 * hand-written payload, which happened to omit `details` entirely. So these
 * assertions are deliberately made against deltas **captured from real store
 * transitions**, never against a payload written by hand. If the client's wire
 * shape drifts from what `backend/src/validators/queryStateSchemas.js` accepts,
 * this is the test that should fail first.
 */

const s = () => useWorkflowStore.getState();
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');
const ADMIN = findUserById('USR-0007');

/** The names `backend/src/validators/queryStateSchemas.js` will accept. */
const KNOWN_EVENTS = new Set(Object.values(AUDIT_EVENT));

/** Every delta the store emitted during the block, in order. */
const captured = [];

/**
 * Parse every captured delta with the server's own schema, and report the
 * failing field paths rather than just "expected true".
 *
 * `JSON.parse(JSON.stringify(...))` first, because that is what axios does to
 * the body — and the difference matters: `{ event: undefined }` is a present
 * key in the object and an absent one in the request, which is precisely how
 * the first of these bugs hid.
 */
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
  // `useWorkflowStore` imports this as the default `approve` argument, and a
  // default parameter is read on entry — so the export has to exist even where
  // a test injects its own.
  grantFinalApproval: vi.fn(async (queryId) => ({ queryId, approved: true })),
  persistQueryTransition: vi.fn(async (delta) => {
    captured.push(delta);
    return { success: true };
  }),
}));

const enquiry = () => ({
  mailboxMessageId: 'gmail-msg-contract-1',
  providerMessageId: 'gmail-msg-contract-1',
  providerThreadId: 'gmail-thread-contract-1',
  to: 'front-office@test.invalid',
  from: 'A Member of the Public <someone@example.com>',
  subject: 'Clarification on dissolution limits',
  body: 'Please clarify.',
  receivedAt: '2026-09-17T09:00:00.000Z',
  attachments: [],
});

/** Wait for the fire-and-forget persistDelta at useWorkflowStore.js:293. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The forward is a server call now, and this suite's server only captures
 * deltas — it stores nothing. So this stands in for the one effect the chain
 * below depends on: the case moving to PENDING_ASSIGNMENT, which the real
 * endpoint does after the email goes out. `fetchAllQueries` echoes the store
 * (see `beforeEach`), so the move survives the refresh that follows.
 *
 * Nothing is captured from it, which is itself the contract: forwarding emits
 * no client delta any more.
 */
const fakeForward = async ({ queryId }) => {
  useWorkflowStore.setState((state) => ({
    queries: state.queries.map((q) =>
      q.queryId === queryId ? { ...q, workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT } : q,
    ),
  }));
  return { queryId, emailType: 'FORWARD', outcome: 'SENT' };
};

/**
 * One case carried by real store actions as far as its first review level.
 *
 * Deliberately the long way round rather than `setState` with a fixture: the
 * whole point of this file is that the deltas asserted on are the ones the app
 * actually emits, and a fixture can only reproduce the shape someone believed
 * it had.
 */
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

/** Everything the server would answer with, given the transitions so far. */
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
  /**
   * Every server-side action re-reads `GET /queries` afterwards. Nothing here
   * stores what it is handed, so the honest answer to that read is "exactly
   * what you have" — anything less wipes the case the next step acts on.
   */
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

    // Not "an object sometimes" — a string, every time, from every transition.
    for (const delta of withDetails) {
      expect(typeof delta.auditEvent.details).toBe('string');
    }

    // And the specific sentence verifyQuery emits, so a rename is caught here
    // rather than by a 400 in production.
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

    // Each of these was silently stripped by the server's validator. Losing
    // threadId orphaned every email from its thread; losing
    // sourceMailboxMessageId disarmed the duplicate guard, which tests for its
    // absence and so matched every case after a reload.
    expect(query.threadId).toEqual(expect.any(String));
    expect(query.sourceMailboxMessageId).toBe('gmail-msg-contract-1');
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
    expect(message.sourceMessageId).toBe('gmail-msg-contract-1');
    expect(message.providerThreadId).toBe('gmail-thread-contract-1');
  });
});

describe('every transition names its audit event', () => {
  /**
   * The incident: QueryDetailPage's `onSummaryUpdated` called `applyTransition`
   * with no `event`. `computeTransition` built
   * `{ auditId, queryId, event: undefined, ... }`, `JSON.stringify` dropped the
   * key rather than sending null, and the server's `auditEventSchema` requires
   * `event: z.string()` — so the whole batch was rejected. `persistDelta` is
   * fire-and-forget, so the only symptom was a toast reading "Changes were not
   * saved": the case looked updated in the tab and was never written.
   */
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

    // Descriptive enough to find the call site from the message alone, which is
    // the whole reason this throws instead of persisting a nameless event.
    expect(withNoEvent).toThrow(/must name an audit event/);
    expect(withNoEvent).toThrow(queryId);
    expect(withNoEvent).toThrow('AUDIT_EVENT');

    // The refusal has to be total. Applying the patch and then failing to write
    // it is exactly the divergence between tab and database that was the bug.
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

    // And the chain really ran end to end, rather than one action repeating —
    // otherwise the loop above proves nothing about the transitions it missed.
    expect(captured.map((d) => d.auditEvent.event)).toEqual(
      expect.arrayContaining([
        AUDIT_EVENT.QUERY_RECEIVED,
        AUDIT_EVENT.QUERY_REGISTERED,
        // No QUERY_FORWARDED: forwarding is a server call, and the row is
        // written where the email is sent. The browser emits no delta for it.
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

    // AuditHistoryCard keys its rows on auditId, so a repeat is a React key
    // collision on screen and two events claiming one id in the trail.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a review delta keeps the words the reviewer wrote', () => {
  /** The single review row the transition under test put on the wire. */
  const reviewOnTheWire = () => captured.find((d) => d.addReviews?.length)?.addReviews?.[0];

  /**
   * `comment`, singular — the Mongoose model called it `comments` and the
   * schema followed, so the reviewer's sentence was dropped on every write and
   * the drafter was told to make changes with no note of what they were. The
   * backend field has since been renamed to match the client; these pin the
   * client half of that agreement.
   *
   * `responseId` and `version` matter for the same reason: a comment that is
   * not bound to the text it was written about stops being meaningful as soon
   * as the next revision supersedes that version.
   */
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
    // persistDelta is fire-and-forget, so the approval delta has not landed in
    // `captured` yet — clearing before it does would leave it to be mistaken
    // for the one this test is about.
    await settled();
    captured.length = 0;

    s().returnForRevisionFromApproval(queryId, 'Spell the citation out in full.', OIC);
    await settled();

    const review = reviewOnTheWire();
    expect(review).toBeDefined();
    expect(review.comment).toBe('Spell the citation out in full.');
    expect(review.responseId).toEqual(expect.any(String));
    expect(review.version).toBe('v1');

    // Null on purpose, and legitimately so: the Officer-in-Charge returns the
    // case from final approval, which belongs to no review level. The schema
    // required a string here, so this one action 400ed every time.
    expect(review.stepId).toBeNull();
  });
});

describe('the final-approval lock survives the trip', () => {
  /**
   * `saveDraftVersion` refuses an edit when any version of the case is
   * FINAL_APPROVED — it reads `status` off the version rows. So the lock is
   * only as durable as that one field is on the wire: strip it and the lock
   * lasts exactly as long as the tab stays open, after which the approved
   * response is editable again behind its own approval.
   */
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
      // Both are DRAFT at this point; what is being pinned is that the field
      // the lock is read from reaches the server at all.
      expect(version.status).toBe(RESPONSE_STATUS.DRAFT);
    }
  });

  it('keeps the FINAL_APPROVED status a reload brings back', async () => {
    const queryId = await caseAwaitingReview();
    s().approveReview(queryId, 'No objection from review.', REVIEWER);
    await settled();

    const approved = s().getLatestVersion(queryId);
    expect(approved.status).toBe(RESPONSE_STATUS.DRAFT);

    /**
     * Granting final approval is a server operation now: `grantFinalApproval`
     * posts to /queries/:id/final-approval and then reads the result back
     * through `refreshFromServer`. So this side only holds the lock if the
     * reload carries `status` — this is that reload, with the status the server
     * set. Dropping the field anywhere on the read path is the "lock evaporated
     * after a refresh" report.
     */
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

  /**
   * Granting the approval is no longer this client's write at all.
   *
   * It used to record the approval locally and then call `POST /emails/response`
   * itself — from the Officer-in-Charge's session, when sending is gated on
   * DISPATCH, a Front Office permission. Every real approval therefore returned
   * 403 and left the case approved, locked and unanswered. The server does both
   * halves now, under the Front Office identity it already holds, and this side
   * re-reads the result. So there is nothing left to assert about a
   * final-approval delta; what is still this client's to get right is which
   * case it asks about, and that it does not also write its own version of
   * events.
   *
   * The server's rules — approval recorded before any mail, CLOSED only after a
   * send that happened — are pinned in backend/src/test/finalApproval.test.js.
   */
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

    // The case reads back as the server left it, rather than as this tab
    // guessed it would be — two writers to one case is how the 403 stayed
    // invisible for as long as it did.
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);

    await settled();
    expect(captured).toEqual([]);
  });
});

/**
 * The client's wire shape, checked against the server's actual schema.
 *
 * Every other test in this file asserts a field the author already knew to look
 * for, which is why three separate 400s reached a running system: a missing
 * `auditEvent.event`, a `stepId: null` the schema called required, and a
 * `comment: null` written by a reviewer who approved without typing anything.
 * Each was a field nobody had thought to assert.
 *
 * So this imports the real `persistTransitionSchema` — the same module Express
 * runs — and parses whatever the store emitted. No fixture, no second copy of
 * the contract to drift. If the client starts sending something the server will
 * refuse, this fails here rather than as a toast in somebody's browser.
 */
describe('the server would accept every delta the store emits', () => {
  it('parses a whole case, from arrival to the reviewer approving', async () => {
    const queryId = await caseAwaitingReview();

    // Approving with NO comment is the ordinary path, and the one that 400ed:
    // `approveReview` sends `comment: comment || null`, and the schema field
    // was `.optional()` rather than `.nullable()`.
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

  /**
   * The Officer-in-Charge returning a draft from final approval, where no
   * review level is open — the review that carries `stepId: null` and 400ed.
   */
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
