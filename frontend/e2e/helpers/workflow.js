import { expect } from '@playwright/test';

import {
  ASSIGNED_OFFICIAL_USER,
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

export const INBOX_PATH = '/super-admin/inbox';
export const assignmentPath = (queryId) => `/officer-in-charge/assignments/${queryId}`;
export const draftingPath = (queryId) => `/assigned-official/drafting/${queryId}`;
export const reviewPath = (queryId) => `/reviewer/reviews/${queryId}`;
export const approvalPath = (queryId) => `/officer-in-charge/approvals/${queryId}`;
export const dispatchPath = (queryId) => `/super-admin/dispatch/${queryId}`;
export const casePath = (queryId) => `/super-admin/queries/${queryId}`;
export const currentYear = () => new Date().getUTCFullYear();
export const POLL = { timeout: 60_000 };
export const REVIEW_COMMENT = 'Checked against the monograph; the cited limits are correct.';
export async function caseById(queryId) {
  const [row] = await readQueryCases(queryId ? { queryId } : {});
  return row ?? null;
}
export const stateOf = async (queryId) => (await caseById(queryId))?.workflowState ?? null;
export async function auditTrail(queryId) {
  const rows = await readAuditEvents({ queryId });
  return rows
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .map((row) => row.action);
}
export const only = (trail, expected) => trail.filter((action) => expected.includes(action));
export async function arrive(request, { from, subject, body }) {
  await devSignIn(request, SUPER_ADMIN_USER.email);
  return injectInboundMessage(request, { from, subject, body });
}
export async function accept(page, message) {
  await signInAs(page, SUPER_ADMIN_USER.email);
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
export async function intake(page, request, enquiry) {
  const message = await arrive(request, enquiry);
  const row = await accept(page, message);
  return { message, queryCase: row, queryId: row.queryId };
}
export async function assign(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(assignmentPath(queryId));
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
export async function draftAndSubmit(page, queryId) {
  await signInAs(page, ASSIGNED_OFFICIAL_USER.email);
  await page.goto(draftingPath(queryId));
  await page.getByRole('button', { name: 'Generate AI draft', exact: true }).click();
  await expect
    .poll(async () => (await readResponseVersions({ queryId })).length, POLL)
    .toBe(1);
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
export async function review(page, queryId) {
  await signInAs(page, REVIEWER_USER.email);
  await page.goto(reviewPath(queryId));
  await page.getByLabel('Comments', { exact: true }).fill(REVIEW_COMMENT);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => stateOf(queryId), POLL).toBe('PENDING_FINAL_APPROVAL');
}
export async function approve(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
}
export async function driveToFinalApproval(page, request, enquiry) {
  const { message, queryId } = await intake(page, request, enquiry);
  await assign(page, queryId);
  await draftAndSubmit(page, queryId);
  await review(page, queryId);
  return { message, queryId };
}
