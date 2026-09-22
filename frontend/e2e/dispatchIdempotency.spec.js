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

/**
 * One inquirer, one answer — however many times Approve is pressed.
 *
 * In the live run an officer pressed Approve four times while the first send
 * hung twenty-two seconds on a DNS failure, and the inquirer received the same
 * response three times. Two things had to be wrong at once for that: the
 * button stayed enabled while its request was open, and the server checked
 * "has this already been sent?" separately from sending it, so all four
 * requests passed the check before any of them recorded anything.
 *
 * Both halves are tested here, and separately: the button, by clicking it while
 * its request is held open; the server, by going around the browser entirely
 * and firing three approvals at the API at once. The second is the one that
 * matters — a guard that only exists in the browser is not a guard.
 */

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

  /**
   * Hold the approval request open, exactly as the hung DNS lookup did.
   *
   * `page.route` intercepts before the request leaves the browser, so the
   * button is left in the state a slow network puts it in: pressed, waiting,
   * and — if nothing else were true — pressable again.
   */
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

  // The button now says what it is doing, and refuses to do it again.
  const busy = page.getByRole('button', { name: 'Approving and sending…', exact: true });
  await expect(busy).toBeDisabled();

  // Three more presses of a disabled button, which is what an impatient user
  // does. `force` bypasses Playwright's own actionability wait — without it
  // this would simply time out waiting for the button to become enabled, and
  // would prove nothing about what happens when it is clicked.
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

  /**
   * Straight at the API, with no browser in the way: three requests in flight
   * together on the approving officer's session. This is the case the client's
   * in-flight guard cannot cover — three tabs, or two officers, or a retry
   * from a proxy — and it is the one the ledger's atomic claim exists for.
   */
  await devSignIn(request, OFFICER_IN_CHARGE_USER.email);

  const results = await Promise.all(
    [1, 2, 3].map(() =>
      request.post(`${API_BASE}/queries/${queryId}/final-approval`, { data: {} }),
    ),
  );

  // Every one of them is answered — none is left hanging or 500s.
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
  // The decision was taken once, and the answer sent once.
  expect(trail.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'QUERY_CLOSED')).toHaveLength(1);

  const closed = await caseById(queryId);
  expect(closed.workflowState).toBe('CLOSED');
});

test('a retry after a failed send delivers exactly one response', async ({ page, request }) => {
  test.setTimeout(300_000);

  const { queryId } = await driveToFinalApproval(page, request, ENQUIRY);

  // The next outgoing email fails at the transport — see helpers/db.js.
  const blocker = await blockNextMailboxDelivery();

  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect.poll(() => auditTrail(queryId), POLL).toContain('EMAIL_SEND_FAILED');

  const stranded = await caseById(queryId);
  expect(stranded.workflowState).toBe('READY_FOR_DISPATCH');
  expect(await responsesTo(queryId)).toHaveLength(0);

  /**
   * The failure is on the case, in the ledger, and it says the send never
   * happened — which is what makes the retry safe to offer. A send that could
   * not be classified would read UNCERTAIN instead, and the page would ask for
   * the Sent folder to be checked rather than offering a retry at all.
   */
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

  // Pressing it again on a closed case cannot produce a second copy: the
  // control is gone, and the record says the email has been sent.
  await page.goto(dispatchPath(queryId));
  await expect(
    page.getByRole('button', { name: 'Retry sending response', exact: true }),
  ).toHaveCount(0);

  expect(await responsesTo(queryId)).toHaveLength(1);
  const trail = await auditTrail(queryId);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'FINAL_APPROVAL_GRANTED')).toHaveLength(1);
});
