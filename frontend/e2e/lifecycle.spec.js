import { test, expect } from '@playwright/test';

import {
  ASSIGNED_OFFICIAL_USER,
  FRONT_OFFICE_USER,
  OFFICER_IN_CHARGE_USER,
  REVIEWER_USER,
  SUPER_ADMIN_USER,
  devSignIn,
  injectInboundMessage,
  signInAs,
} from './helpers/api.js';
import {
  blockNextMailboxDelivery,
  closeDb,
  readAuditEvents,
  readEmailMessages,
  readQueryCases,
  readResponseVersions,
  readReviews,
  readWorkflowSteps,
  resetDatabase,
  unblockMailboxDelivery,
} from './helpers/db.js';

/**
 * One enquiry, from the mail arriving to the case closing — driven through the
 * screens each role actually uses, and asserted against MongoDB at every stage.
 *
 * The assertions are deliberately never about what the page says. A stage is
 * "done" when the row the *next* stage reads has changed, and that row is in
 * Mongo: the assignment is `currentAssigneeId` on the case, the review is a
 * document in `reviews` and a COMPLETED step in `workflowsteps`, the answer is
 * one OUTGOING_RESPONSE in `emailmessages` addressed to the person who wrote
 * in. A screen that claims all of this while the database says otherwise is the
 * exact failure this file exists to catch.
 *
 * The middle of the workflow — assign, draft, review — has no REST endpoint.
 * Those are client-side store operations that reach the server only through
 * `POST /queries/persist`, so the only honest way to drive them is the UI,
 * signed in as each role in turn. `persistDelta` is fire-and-forget
 * (useWorkflowStore.js applies the transition locally and does not await the
 * write), so every stage ends by polling Mongo rather than by trusting the
 * click to have landed.
 */

/**
 * An external enquirer. `.example` is reserved by RFC 2606 and can never
 * receive mail. The final response goes to *this* address, read off the From
 * header at intake — not to any address the deployment has configured — and the
 * closing assertion is precisely that.
 */
const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';

const SUBJECT = 'Dissolution limits for Metformin HCl tablets';
const BODY = [
  'We are seeking clarification on the dissolution specification for Metformin',
  'Hydrochloride tablets in the current monograph. Please confirm which apparatus',
  'and medium apply for the 500 mg strength.',
].join(' ');

/** ROLE_SLUG + SECTIONS[...].segment — frontend/src/constants/{permissions,routeSections}.js. */
const INBOX_PATH = '/front-officer/inbox';
const assignmentPath = (queryId) => `/officer-in-charge/assignments/${queryId}`;
const draftingPath = (queryId) => `/assigned-official/drafting/${queryId}`;
const reviewPath = (queryId) => `/reviewer/reviews/${queryId}`;
const approvalPath = (queryId) => `/officer-in-charge/approvals/${queryId}`;
const dispatchPath = (queryId) => `/front-officer/dispatch/${queryId}`;

/** mintIds() in acceptMessage.js labels the id with the UTC year. */
const currentYear = () => new Date().getUTCFullYear();

/** Generous: a stage is a sign-in, a cold route chunk and a fire-and-forget write. */
const POLL = { timeout: 60_000 };

/** The single case these tests work on. */
const theCase = async () => (await readQueryCases())[0] ?? null;

const workflowState = async () => (await theCase())?.workflowState ?? null;

/**
 * Every audit action recorded against one case, in the order it was written.
 *
 * Sorted by `_id` rather than by `timestamp`: several of these rows are written
 * inside the same millisecond, and every one of them comes from the same
 * backend process — both the rows the server writes itself and the rows the
 * client sends through /queries/persist — so ObjectId order is creation order
 * and ISO timestamps are not fine-grained enough to distinguish them.
 */
async function auditTrail(queryId) {
  const rows = await readAuditEvents({ queryId });
  return rows
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .map((row) => row.action);
}

/** The subsequence of `trail` made of the actions in `expected`. */
const only = (trail, expected) => trail.filter((action) => expected.includes(action));


// ── The stages ───────────────────────────────────────────────────────────────
//
// Each drives one role through one screen and then waits on the database. They
// are shared by both tests below, which differ only in what happens at the very
// end, once the case is sitting at PENDING_FINAL_APPROVAL.

/** Mail arrives; the Front Officer presses ✓. */
async function intake(page, request) {
  await devSignIn(request, SUPER_ADMIN_USER.email);
  const message = await injectInboundMessage(request, {
    from: SENDER,
    subject: SUBJECT,
    body: BODY,
  });

  await signInAs(page, FRONT_OFFICE_USER.email);
  await page.goto(INBOX_PATH);

  await page
    .getByRole('button', { name: `Accept message ${message.mailboxMessageId}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();

  await expect.poll(workflowState, POLL).toBe('PENDING_ASSIGNMENT');

  return message;
}

/** The Officer-in-Charge picks an official from the full directory. */
async function assign(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(assignmentPath(queryId));

  // The "Or Manual Assignment" picker. Reached by role because its <Label
  // htmlFor="override-assignee"> points at an id nothing renders — see the
  // note at the foot of this file.
  await page.getByRole('combobox').click();
  await page
    .getByRole('option', { name: new RegExp(`^${ASSIGNED_OFFICIAL_USER.name}`) })
    .click();
  await page.getByRole('button', { name: 'Assign Selected Official', exact: true }).click();

  await expect
    .poll(async () => {
      const row = await theCase();
      return row && { state: row.workflowState, assignee: row.currentAssigneeId };
    }, POLL)
    .toEqual({ state: 'ASSIGNED', assignee: ASSIGNED_OFFICIAL_USER.id });
}

/**
 * The assigned official drafts, names a reviewer, and sends it on.
 *
 * The first version has to come from "Generate AI draft": with no versions yet
 * the editor renders an empty state rather than a textarea, so there is nothing
 * to type into until one exists. GEMMA_API_URL is empty under .env.e2e, so the
 * server returns its deterministic draft — which is the point, not a shortcut.
 */
async function draftAndSubmit(page, queryId) {
  await signInAs(page, ASSIGNED_OFFICIAL_USER.email);
  await page.goto(draftingPath(queryId));

  await page.getByRole('button', { name: 'Generate AI draft', exact: true }).click();
  await expect
    .poll(async () => (await readResponseVersions({ queryId })).length, POLL)
    .toBe(1);

  // Adding a review level only becomes available at DRAFTING, which the draft
  // above is what produced.
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: REVIEWER_USER.name, exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect
    .poll(async () => {
      const [step] = await readWorkflowSteps({ queryId, stepType: 'REVIEW' });
      return step?.assignedUserId ?? null;
    }, POLL)
    .toBe(REVIEWER_USER.id);

  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect.poll(workflowState, POLL).toBe('UNDER_REVIEW');
}

/**
 * The reviewer the draft was addressed to approves it.
 *
 * The comment is typed rather than left blank, and that is not decoration: an
 * approval with an empty comment is currently **lost**. `approveReview` writes
 * `comment: comment || null`, and `reviewSchema.comment` in
 * backend/src/validators/queryStateSchemas.js is `z.string().optional()`, which
 * rejects an explicit null — so the whole delta 400s, and because `persistDelta`
 * is fire-and-forget the tab shows the case as approved while the database
 * still reads UNDER_REVIEW. Typing a comment is a real reviewer action and gets
 * the lifecycle past it; the defect is reported rather than asserted here,
 * because fixing it means changing `src/`.
 */
const REVIEW_COMMENT = 'Checked against the monograph; the cited limits are correct.';

async function review(page, queryId) {
  await signInAs(page, REVIEWER_USER.email);
  await page.goto(reviewPath(queryId));

  await page.getByLabel('Comments', { exact: true }).fill(REVIEW_COMMENT);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect.poll(workflowState, POLL).toBe('PENDING_FINAL_APPROVAL');
}

/** Everything up to the Officer-in-Charge's final decision. */
async function driveToFinalApproval(page, request) {
  const message = await intake(page, request);
  const { queryId } = await theCase();

  await assign(page, queryId);
  await draftAndSubmit(page, queryId);
  await review(page, queryId);

  return { message, queryId };
}

test.beforeEach(async () => {
  await resetDatabase();
});

test.afterAll(async () => {
  await closeDb();
});

test('an enquiry runs the full lifecycle and closes only once the answer was sent', async ({
  page,
  request,
}) => {
  // Five sign-ins and five cold route chunks — well past the 90s default.
  test.setTimeout(300_000);

  const message = await intake(page, request);

  // ── Intake ────────────────────────────────────────────────────────────────
  const registered = await theCase();
  expect(registered.queryId).toBe(`QRY-${currentYear()}-00001`);
  expect(await readQueryCases()).toHaveLength(1);
  expect(registered.sourceMailboxMessageId).toBe(message.mailboxMessageId);

  // The enquirer is whoever wrote in — never a configured stakeholder address.
  expect(registered.inquirer.email).toBe(SENDER_EMAIL);
  expect(registered.inquirer.name).toBe('Ravi Kumar');

  /**
   * FALLBACK, and that is the correct outcome rather than a tolerated one.
   *
   * GEMMA_API_URL is empty under .env.e2e, so `generateSummary` returns its
   * deterministic stand-in. `status` exists to keep that distinguishable from
   * a summary the model actually wrote, so the assertion is on the status and
   * on the two provenance flags underneath it — a FALLBACK that claimed
   * `aiGenerated` would be the bug.
   */
  expect(registered.aiSummary.status).toBe('FALLBACK');
  expect(registered.aiSummary.fallback).toBe(true);
  expect(registered.aiSummary.aiGenerated).toBe(false);
  expect(registered.aiSummary.text).toContain(SUBJECT);
  expect(registered.aiSummary.generatedAt).toBeTruthy();
  expect(registered.aiSummary.error).toBeNull();

  const intakeMail = await readEmailMessages({ queryId: registered.queryId });

  const acknowledgement = intakeMail.find((mail) => mail.emailType === 'ACKNOWLEDGEMENT');
  expect(acknowledgement.direction).toBe('OUTBOUND');
  expect(acknowledgement.to).toContain(SENDER_EMAIL);

  const forward = intakeMail.find((mail) => mail.emailType === 'FORWARD');
  expect(forward.direction).toBe('OUTBOUND');

  expect(registered.workflowState).toBe('PENDING_ASSIGNMENT');

  expect(
    only(await auditTrail(registered.queryId), [
      'QUERY_RECEIVED',
      'QUERY_REGISTERED',
      'AI_SUMMARY_GENERATED',
      'ACKNOWLEDGEMENT_SENT',
      'QUERY_FORWARDED',
    ]),
  ).toEqual([
    'QUERY_RECEIVED',
    'QUERY_REGISTERED',
    'AI_SUMMARY_GENERATED',
    'ACKNOWLEDGEMENT_SENT',
    'QUERY_FORWARDED',
  ]);

  const { queryId } = registered;

  // ── Assignment ────────────────────────────────────────────────────────────
  await assign(page, queryId);

  const assigned = await theCase();
  expect(assigned.currentAssigneeId).toBe(ASSIGNED_OFFICIAL_USER.id);
  expect(assigned.assignmentDecision.assigneeId).toBe(ASSIGNED_OFFICIAL_USER.id);
  expect(assigned.businessStatus).toBe('IN_PROGRESS');

  // ── Drafting ──────────────────────────────────────────────────────────────
  await draftAndSubmit(page, queryId);

  const [draft] = await readResponseVersions({ queryId });
  expect(draft.version).toBe('v1');
  expect(draft.content.length).toBeGreaterThan(0);
  expect(draft.status).toBe('DRAFT');

  const steps = await readWorkflowSteps({ queryId });
  expect(steps.filter((step) => step.stepType === 'REVIEW')).toHaveLength(1);
  expect(steps.some((step) => step.stepType === 'FINAL_APPROVAL')).toBe(true);

  const submitted = await theCase();
  expect(submitted.workflowState).toBe('UNDER_REVIEW');
  // The case points at the review level that is now open, and it is the one
  // the reviewer below signs in as.
  const openReview = steps.find((step) => step.stepId === submitted.currentWorkflowStepId);
  expect(openReview.stepType).toBe('REVIEW');
  expect(openReview.assignedUserId).toBe(REVIEWER_USER.id);

  // ── Review ────────────────────────────────────────────────────────────────
  await review(page, queryId);

  const [decision] = await readReviews({ queryId });
  expect(decision.decision).toBe('APPROVED');
  expect(decision.reviewerId).toBe(REVIEWER_USER.id);
  expect(decision.version).toBe('v1');
  // The reviewer's words reached the database, bound to the draft they judged.
  expect(decision.comment).toBe(REVIEW_COMMENT);
  expect(decision.responseId).toBe(draft.responseId);

  expect(
    (await readWorkflowSteps({ queryId, stepType: 'REVIEW' }))[0].status,
  ).toBe('COMPLETED');

  // ── Final approval, and the answer ────────────────────────────────────────
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect
    .poll(async () => {
      const row = await theCase();
      const responses = await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' });
      return row && {
        state: row.workflowState,
        status: row.businessStatus,
        responses: responses.length,
      };
    }, POLL)
    .toEqual({ state: 'CLOSED', status: 'CLOSED', responses: 1 });

  const [response] = await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' });
  expect(response.direction).toBe('OUTBOUND');
  // The answer went to the person who wrote in, not to a configured address.
  expect(response.to).toEqual([SENDER_EMAIL]);
  expect(response.subject).toContain(queryId);
  expect(response.body).toBe(draft.content);

  // The approved version is locked, and it is the one that was sent.
  const [locked] = await readResponseVersions({ queryId });
  expect(locked.status).toBe('FINAL_APPROVED');
  expect(locked.responseId).toBe(draft.responseId);

  expect(
    only(await auditTrail(queryId), [
      'FINAL_APPROVAL_GRANTED',
      'RESPONSE_DISPATCHED',
      'QUERY_CLOSED',
    ]),
  ).toEqual(['FINAL_APPROVAL_GRANTED', 'RESPONSE_DISPATCHED', 'QUERY_CLOSED']);

  // Nothing was sent twice along the way either.
  const allMail = await readEmailMessages({ queryId });
  expect(allMail.filter((mail) => mail.emailType === 'ACKNOWLEDGEMENT')).toHaveLength(1);
  expect(allMail.filter((mail) => mail.emailType === 'FORWARD')).toHaveLength(1);
  expect(allMail.filter((mail) => mail.emailType === 'OUTGOING_RESPONSE')).toHaveLength(1);
});

test('a final response that cannot be sent leaves the case open, and the retry closes it', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);

  const { queryId } = await driveToFinalApproval(page, request);

  // The next outgoing email will fail at the transport. See
  // blockNextMailboxDelivery in helpers/db.js for why it has to be injected
  // there: under EMAIL_TRANSPORT=mock there is no configuration that makes a
  // send fail, and a mock success is deliberately counted as real delivery.
  const blocker = await blockNextMailboxDelivery();

  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect
    .poll(async () => auditTrail(queryId), POLL)
    .toContain('EMAIL_SEND_FAILED');

  /**
   * The decision stands; only the send failed. A case reading CLOSED while the
   * inquirer received nothing is the single worst state this workflow can
   * reach, because nobody goes looking for it — so the assertion is that it did
   * NOT happen, not merely that an error was reported somewhere.
   */
  const stranded = await theCase();
  expect(stranded.workflowState).toBe('READY_FOR_DISPATCH');
  expect(stranded.businessStatus).not.toBe('CLOSED');
  expect(await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' })).toHaveLength(0);

  // Approved, locked, and waiting — the response exists, it just went nowhere.
  expect((await readResponseVersions({ queryId }))[0].status).toBe('FINAL_APPROVED');

  // AUDIT_RESULTS.FAILURE — lower case in backend/src/constants/auditActions.js.
  const failure = (await readAuditEvents({ queryId, action: 'EMAIL_SEND_FAILED' }))[0];
  expect(failure.result).toBe('failure');
  expect(failure.queryId).toBe(queryId);
  expect(failure.error).toBeTruthy();

  const trail = await auditTrail(queryId);
  expect(trail).toContain('FINAL_APPROVAL_GRANTED');
  expect(trail).not.toContain('RESPONSE_DISPATCHED');
  expect(trail).not.toContain('QUERY_CLOSED');

  // ── The retry: the Front Office control that exists for exactly this ──────
  await unblockMailboxDelivery(blocker);

  await signInAs(page, FRONT_OFFICE_USER.email);
  await page.goto(dispatchPath(queryId));
  await page.getByRole('button', { name: 'Retry sending response', exact: true }).click();

  await expect
    .poll(async () => {
      const row = await theCase();
      const responses = await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' });
      return row && {
        state: row.workflowState,
        status: row.businessStatus,
        responses: responses.length,
      };
    }, POLL)
    .toEqual({ state: 'CLOSED', status: 'CLOSED', responses: 1 });

  const [response] = await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' });
  expect(response.to).toEqual([SENDER_EMAIL]);

  const closed = await auditTrail(queryId);
  expect(only(closed, ['RESPONSE_DISPATCHED', 'QUERY_CLOSED'])).toEqual([
    'RESPONSE_DISPATCHED',
    'QUERY_CLOSED',
  ]);
  // The approval was taken once and is not re-taken by the retry.
  expect(closed.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
});

/**
 * Controls with no accessible name, reported rather than worked around.
 *
 * Both are Radix `Select`s given an `id` on `Select.Root`, which renders no DOM
 * node at all — so the `<Label htmlFor>` beside each one points at nothing and
 * the trigger has no accessible name. `getByLabel` cannot find either; this
 * file reaches them with `getByRole('combobox')`, which works only because each
 * page happens to have exactly one.
 *
 *   - frontend/src/pages/assignments/AssignmentDetailPage.jsx — "Choose from
 *     full directory" / `id="override-assignee"`.
 *   - frontend/src/components/workflow/AddReviewLevelField.jsx — "Add Reviewer
 *     I" / `id="new-reviewer"`, used by the drafting and review pages.
 *
 * The fix belongs in `src/`: move the id onto `SelectTrigger`, or give the
 * trigger an `aria-label`. No test id was added to `src/` to paper over it.
 */
