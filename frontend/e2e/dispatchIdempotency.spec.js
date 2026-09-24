import { test, expect } from '@playwright/test';

import {
  API_BASE,
  FRONT_OFFICE_USER,
  OFFICER_IN_CHARGE_USER,
  devSignIn,
  signInAs,
} from './helpers/api.js';
import {
  blockNextMailboxDelivery,
  closeDb,
  readAuditEvents,
  readEmailMessages,
  resetDatabase,
  unblockMailboxDelivery,
} from './helpers/db.js';
import {
  POLL,
  approvalPath,
  auditTrail,
  caseById,
  dispatchPath,
  driveToFinalApproval,
} from './helpers/workflow.js';

const SENDER = 'Meera Nair <meera@pharma.example>';
const SENDER_EMAIL = 'meera@pharma.example';

const ENQUIRY = {
  from: SENDER,
  subject: 'Assay method for a fixed-dose combination',
  body: 'Please confirm the applicable assay method and the acceptance criteria.',
};

const responsesTo = (queryId) => readEmailMessages({ queryId, emailType: 'OUTGOING_RESPONSE' });

test.beforeEach(async () => {
  await resetDatabase();
});

test.afterAll(async () => {
  await closeDb();
});

test('Approve cannot be pressed twice while its request is open', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { queryId } = await driveToFinalApproval(page, request, ENQUIRY);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });

  let attempts = 0;
  await page.route(`**/queries/${queryId}/final-approval`, async (route) => {
    attempts += 1;
    await held;
    await route.continue();
  });

  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));

  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await approve.click();

  const busy = page.getByRole('button', { name: 'Approving and sending…', exact: true });
  await expect(busy).toBeDisabled();
  await busy.click({ force: true });
  await busy.click({ force: true });
  await busy.click({ force: true });

  expect(attempts).toBe(1);

  release();

  await expect
    .poll(async () => {
      const row = await caseById(queryId);
      return row && { state: row.workflowState, responses: (await responsesTo(queryId)).length };
    }, POLL)
    .toEqual({ state: 'CLOSED', responses: 1 });

  expect(attempts).toBe(1);

  const trail = await auditTrail(queryId);
  expect(trail.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
});

test('three approvals arriving at once still send one response', async ({ page, request }) => {
  test.setTimeout(300_000);

  const { queryId } = await driveToFinalApproval(page, request, ENQUIRY);

  await devSignIn(request, OFFICER_IN_CHARGE_USER.email);

  const results = await Promise.all(
    [1, 2, 3].map(() =>
      request.post(`${API_BASE}/queries/${queryId}/final-approval`, { data: {} }),
    ),
  );

  for (const response of results) {
    expect(
      [200, 201, 409].includes(response.status()),
      `unexpected ${response.status()}: ${await response.text()}`,
    ).toBeTruthy();
  }

  await expect
    .poll(async () => (await responsesTo(queryId)).length, POLL)
    .toBe(1);

  const [answer] = await responsesTo(queryId);
  expect(answer.to).toEqual([SENDER_EMAIL]);

  const trail = await auditTrail(queryId);
  expect(trail.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'QUERY_CLOSED')).toHaveLength(1);

  const closed = await caseById(queryId);
  expect(closed.workflowState).toBe('CLOSED');
});

test('a retry after a failed send delivers exactly one response', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { queryId } = await driveToFinalApproval(page, request, ENQUIRY);
  const blocker = await blockNextMailboxDelivery();

  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => auditTrail(queryId), POLL).toContain('EMAIL_SEND_FAILED');

  const stranded = await caseById(queryId);
  expect(stranded.workflowState).toBe('READY_FOR_DISPATCH');
  expect(await responsesTo(queryId)).toHaveLength(0);

  const failure = (await readAuditEvents({ queryId, action: 'EMAIL_SEND_FAILED' }))[0];
  expect(failure.result).toBe('failure');
  expect(failure.error).toBeTruthy();

  await unblockMailboxDelivery(blocker);

  await signInAs(page, FRONT_OFFICE_USER.email);
  await page.goto(dispatchPath(queryId));

  const retry = page.getByRole('button', { name: 'Retry sending response', exact: true });
  await retry.click();

  await expect
    .poll(async () => {
      const row = await caseById(queryId);
      return row && { state: row.workflowState, responses: (await responsesTo(queryId)).length };
    }, POLL)
    .toEqual({ state: 'CLOSED', responses: 1 });

  await page.goto(dispatchPath(queryId));
  await expect(
    page.getByRole('button', { name: 'Retry sending response', exact: true }),
  ).toHaveCount(0);

  expect(await responsesTo(queryId)).toHaveLength(1);
  const trail = await auditTrail(queryId);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
});
