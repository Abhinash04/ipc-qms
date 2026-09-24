import { test, expect } from '@playwright/test';

import {
  ASSIGNED_OFFICIAL_USER,
  FRONT_OFFICE_USER,
  OFFICER_IN_CHARGE_USER,
  REVIEWER_USER,
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
import {
  POLL,
  REVIEW_COMMENT,
  approvalPath,
  assign,
  auditTrail,
  caseById,
  currentYear,
  dispatchPath,
  draftAndSubmit,
  driveToFinalApproval,
  intake,
  only,
  review,
} from './helpers/workflow.js';

const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';
const SUBJECT = 'Dissolution limits for Metformin HCl tablets';
const BODY = [
  'We are seeking clarification on the dissolution specification for Metformin',
  'Hydrochloride tablets in the current monograph. Please confirm which apparatus',
  'and medium apply for the 500 mg strength.',
].join(' ');

const ENQUIRY = { from: SENDER, subject: SUBJECT, body: BODY };
const theCase = () => caseById();
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
  test.setTimeout(300_000);
  const { message } = await intake(page, request, ENQUIRY);
  const registered = await theCase();
  expect(registered.queryId).toBe(`QRY-${currentYear()}-00001`);
  expect(await readQueryCases()).toHaveLength(1);
  expect(registered.sourceMailboxMessageId).toBe(message.mailboxMessageId);
  expect(registered.inquirer.email).toBe(SENDER_EMAIL);
  expect(registered.inquirer.name).toBe('Ravi Kumar');
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
  expect(response.to).toEqual([SENDER_EMAIL]);
  expect(response.subject).toContain(queryId);
  expect(response.body).toBe(draft.content);
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

  const { queryId } = await driveToFinalApproval(page, request, ENQUIRY);
  const blocker = await blockNextMailboxDelivery();

  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect
    .poll(async () => auditTrail(queryId), POLL)
    .toContain('EMAIL_SEND_FAILED');

  const stranded = await theCase();
  expect(stranded.workflowState).toBe('READY_FOR_DISPATCH');
  expect(stranded.businessStatus).not.toBe('CLOSED');
  expect(await readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' })).toHaveLength(0);
  expect((await readResponseVersions({ queryId }))[0].status).toBe('FINAL_APPROVED');
  const failure = (await readAuditEvents({ queryId, action: 'EMAIL_SEND_FAILED' }))[0];
  expect(failure.result).toBe('failure');
  expect(failure.queryId).toBe(queryId);
  expect(failure.error).toBeTruthy();
  const trail = await auditTrail(queryId);
  expect(trail).toContain('FINAL_APPROVAL_GRANTED');
  expect(trail).not.toContain('RESPONSE_DISPATCHED');
  expect(trail).not.toContain('QUERY_CLOSED');
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
  expect(closed.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
});
