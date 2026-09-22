import { expect } from '@playwright/test';

import {
  ASSIGNED_OFFICIAL_USER,
  FRONT_OFFICE_USER,
  OFFICER_IN_CHARGE_USER,
  REVIEWER_USER,
  SUPER_ADMIN_USER,
  devSignIn,
  injectInboundMessage,
  signInAs,
} from './api.js';
import {
  readAuditEvents,
  readQueryCases,
  readResponseVersions,
  readWorkflowSteps,
} from './db.js';

/**
 * The stages of the workflow, driven through the screens each role uses.
 *
 * Shared by the lifecycle spec, the two-inquirer spec and the idempotency
 * spec, which differ only in what they do once a case is standing at a
 * particular stage. Every stage ends by polling MongoDB rather than by
 * trusting a click: the middle of the workflow reaches the server through
 * `POST /queries/persist`, which `useWorkflowStore.applyTransition` does not
 * await.
 *
 * Each function takes the case it is acting on, so a spec can interleave two.
 */

/** ROLE_SLUG + SECTIONS[...].segment — src/constants/{permissions,routeSections}.js. */
export const INBOX_PATH = '/front-officer/inbox';
export const assignmentPath = (queryId) => `/officer-in-charge/assignments/${queryId}`;
export const draftingPath = (queryId) => `/assigned-official/drafting/${queryId}`;
export const reviewPath = (queryId) => `/reviewer/reviews/${queryId}`;
export const approvalPath = (queryId) => `/officer-in-charge/approvals/${queryId}`;
export const dispatchPath = (queryId) => `/front-officer/dispatch/${queryId}`;
export const casePath = (queryId) => `/front-officer/queries/${queryId}`;

/** mintIds() in acceptMessage.js labels the id with the UTC year. */
export const currentYear = () => new Date().getUTCFullYear();

/** Generous: a stage is a sign-in, a cold route chunk and a fire-and-forget write. */
export const POLL = { timeout: 60_000 };

export const REVIEW_COMMENT = 'Checked against the monograph; the cited limits are correct.';

/** One case by id, or the only case when there is just one. */
export async function caseById(queryId) {
  const [row] = await readQueryCases(queryId ? { queryId } : {});
  return row ?? null;
}

export const stateOf = async (queryId) => (await caseById(queryId))?.workflowState ?? null;

/**
 * Every audit action recorded against one case, in the order it was written.
 *
 * Sorted by `_id` rather than by `timestamp`: several of these rows are written
 * inside the same millisecond, and every one of them comes from the same
 * backend process — both the rows the server writes itself and the rows the
 * client sends through /queries/persist — so ObjectId order is creation order
 * and ISO timestamps are not fine-grained enough to distinguish them.
 */
export async function auditTrail(queryId) {
  const rows = await readAuditEvents({ queryId });
  return rows
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .map((row) => row.action);
}

/** The subsequence of `trail` made of the actions in `expected`. */
export const only = (trail, expected) => trail.filter((action) => expected.includes(action));

/** Put a message in the IPC mailbox, as an outside enquirer would. */
export async function arrive(request, { from, subject, body }) {
  await devSignIn(request, SUPER_ADMIN_USER.email);
  return injectInboundMessage(request, { from, subject, body });
}

/**
 * The Front Officer accepts one message.
 *
 * Returns the case it produced, identified by the message it came from rather
 * than by "the only case there is" — two inquirers means two cases.
 */
export async function accept(page, message) {
  await signInAs(page, FRONT_OFFICE_USER.email);
  await page.goto(INBOX_PATH);

  await page
    .getByRole('button', { name: `Accept message ${message.mailboxMessageId}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();

  await expect
    .poll(async () => {
      const [row] = await readQueryCases({ sourceMailboxMessageId: message.mailboxMessageId });
      return row?.workflowState ?? null;
    }, POLL)
    .toBe('PENDING_ASSIGNMENT');

  const [row] = await readQueryCases({ sourceMailboxMessageId: message.mailboxMessageId });
  return row;
}

/** Mail arrives; the Front Officer presses ✓. */
export async function intake(page, request, enquiry) {
  const message = await arrive(request, enquiry);
  const row = await accept(page, message);
  return { message, queryCase: row, queryId: row.queryId };
}

/** The Officer-in-Charge picks an official from the full directory. */
export async function assign(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(assignmentPath(queryId));

  // The "Or Manual Assignment" picker. Reached by role because its <Label
  // htmlFor="override-assignee"> points at an id nothing renders — see the
  // note at the foot of lifecycle.spec.js.
  await page.getByRole('combobox').click();
  await page
    .getByRole('option', { name: new RegExp(`^${ASSIGNED_OFFICIAL_USER.name}`) })
    .click();
  await page.getByRole('button', { name: 'Assign Selected Official', exact: true }).click();

  await expect
    .poll(async () => {
      const row = await caseById(queryId);
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
export async function draftAndSubmit(page, queryId) {
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
  await expect.poll(() => stateOf(queryId), POLL).toBe('UNDER_REVIEW');
}

/**
 * The reviewer the draft was addressed to approves it.
 *
 * The comment is typed rather than left blank, and that is not decoration: an
 * approval with an empty comment is currently **lost** — see the note in
 * lifecycle.spec.js.
 */
export async function review(page, queryId) {
  await signInAs(page, REVIEWER_USER.email);
  await page.goto(reviewPath(queryId));

  await page.getByLabel('Comments', { exact: true }).fill(REVIEW_COMMENT);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect.poll(() => stateOf(queryId), POLL).toBe('PENDING_FINAL_APPROVAL');
}

/** The Officer-in-Charge's final decision, which also sends the answer. */
export async function approve(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
}

/** Everything up to the Officer-in-Charge's final decision. */
export async function driveToFinalApproval(page, request, enquiry) {
  const { message, queryId } = await intake(page, request, enquiry);

  await assign(page, queryId);
  await draftAndSubmit(page, queryId);
  await review(page, queryId);

  return { message, queryId };
}
