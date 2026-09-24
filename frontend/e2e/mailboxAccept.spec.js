import { test, expect } from '@playwright/test';

import {
  FRONT_OFFICE_USER,
  SUPER_ADMIN_USER,
  acceptViaApi,
  devSignIn,
  injectInboundMessage,
  signInThroughUi,
} from './helpers/api.js';
import {
  closeDb,
  readAuditEvents,
  readEmailMessages,
  readMailboxDecisions,
  readQueryCases,
  readQueryCounters,
  resetDatabase,
} from './helpers/db.js';

const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';
const INBOX_PATH = '/front-officer/inbox';
const currentYear = () => new Date().getUTCFullYear();
async function decideInUi(page, mailboxMessageId, action) {
  const verb = action === 'accept' ? 'Accept' : 'Reject';
  await page
    .getByRole('button', { name: `${verb} message ${mailboxMessageId}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
}
async function persistedState() {
  const [cases, emails, decisions] = await Promise.all([
    readQueryCases(),
    readEmailMessages(),
    readMailboxDecisions(),
  ]);

  return {
    cases: cases.length,
    workflowState: cases[0]?.workflowState ?? null,
    acknowledgements: emails.filter((email) => email.emailType === 'ACKNOWLEDGEMENT').length,
    forwards: emails.filter((email) => email.emailType === 'FORWARD').length,
    decision: decisions[0]?.decision ?? null,
  };
}

const ACCEPTED_STATE = {
  cases: 1,
  workflowState: 'PENDING_ASSIGNMENT',
  acknowledgements: 1,
  forwards: 1,
  decision: 'ACCEPTED',
};

async function arrive(page, request, subject) {
  await devSignIn(request, SUPER_ADMIN_USER.email);
  const message = await injectInboundMessage(request, {
    from: SENDER,
    subject,
    body: 'Please confirm the applicable impurity limit for the current monograph.',
  });

  await signInThroughUi(page, FRONT_OFFICE_USER.email);
  await page.goto(INBOX_PATH);

  return message;
}

test.beforeEach(async () => {
  await resetDatabase();
});

test.afterAll(async () => {
  await closeDb();
});

test('accepting a message opens one case, acknowledges the sender and forwards it', async ({
  page,
  request,
}) => {
  const message = await arrive(page, request, 'Impurity limit for Paracetamol tablets');

  await decideInUi(page, message.mailboxMessageId, 'accept');

  await expect
    .poll(persistedState, { timeout: 60_000 })
    .toEqual(ACCEPTED_STATE);

  const [queryCase] = await readQueryCases();
  expect(queryCase.queryId).toBe(`QRY-${currentYear()}-00001`);
  expect(queryCase.inquirer.email).toBe(SENDER_EMAIL);
  expect(queryCase.inquirer.name).toBe('Ravi Kumar');
  expect(queryCase.workflowState).toBe('PENDING_ASSIGNMENT');
  expect(queryCase.sourceMailboxMessageId).toBe(message.mailboxMessageId);

  const emails = await readEmailMessages();

  const acknowledgement = emails.find((email) => email.emailType === 'ACKNOWLEDGEMENT');
  expect(acknowledgement.queryId).toBe(queryCase.queryId);
  expect(acknowledgement.direction).toBe('OUTBOUND');
  expect(acknowledgement.to).toContain(SENDER_EMAIL);

  const forward = emails.find((email) => email.emailType === 'FORWARD');
  expect(forward.queryId).toBe(queryCase.queryId);
  expect(forward.direction).toBe('OUTBOUND');

  const [decision] = await readMailboxDecisions();
  expect(decision.decision).toBe('ACCEPTED');
  expect(decision.mailboxMessageId).toBe(message.mailboxMessageId);
  expect(decision.queryId).toBe(queryCase.queryId);
});

test('rejecting a message creates no case and no acknowledgement', async ({ page, request }) => {
  const message = await arrive(page, request, 'Discount pharmaceutical packaging — bulk rates');

  await decideInUi(page, message.mailboxMessageId, 'reject');

  await expect
    .poll(async () => (await readMailboxDecisions())[0]?.decision ?? null, { timeout: 60_000 })
    .toBe('REJECTED');

  expect(await readQueryCases()).toHaveLength(0);
  expect(await readEmailMessages()).toHaveLength(0);

  const [decision] = await readMailboxDecisions();
  expect(decision.mailboxMessageId).toBe(message.mailboxMessageId);
  expect(decision.queryId).toBeNull();
});

test('a message opens in full from the inbox, and shows the case it became once accepted', async ({
  page,
  request,
}) => {
  const subject = 'Dissolution test — Amoxicillin capsules';
  const message = await arrive(page, request, subject);

  await page.getByRole('link', { name: subject, exact: true }).click();

  await expect(page).toHaveURL(`${INBOX_PATH}/${message.mailboxMessageId}`);
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByText('Please confirm the applicable impurity limit for the current monograph.')).toBeVisible();
  await expect(page.getByText('Awaiting validation')).toBeVisible();

  await page.getByRole('link', { name: 'Back to IPC Mailbox' }).click();
  await decideInUi(page, message.mailboxMessageId, 'accept');
  await expect.poll(persistedState, { timeout: 60_000 }).toEqual(ACCEPTED_STATE);

  const [queryCase] = await readQueryCases();
  await page.goto(`${INBOX_PATH}/${message.mailboxMessageId}`);
  await expect(page.getByRole('link', { name: queryCase.queryId })).toBeVisible();
});

test('a formatted body runs no script and cannot take the page anywhere', async ({ page, request }) => {
  const subject = 'Formatted enquiry';
  const message = await arrive(page, request, subject);
  const hostile =
    '<p>Formatted hello</p><script>alert("script")</script><img src="x" onerror="alert(\'img\')">' +
    '<p>after</p><template shadowrootmode="open"><meta http-equiv="refresh" content="0;url=https://example.invalid/">' +
    '<a href="https://example.invalid/">shadow link</a></template>' +
    '<a href="https://example.invalid/">plain link</a>';
  await page.route(`**/api/v1/mailbox/messages/${message.mailboxMessageId}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), bodyHtml: hostile } });
  });

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.getByRole('link', { name: subject, exact: true }).click();
  await page.getByRole('button', { name: 'Formatted' }).click();

  const frame = page.frameLocator('iframe[title="Formatted message body"]');
  await expect(frame.getByText('Formatted hello')).toBeVisible();
  await expect(page.locator('iframe[title="Formatted message body"]')).toHaveAttribute('sandbox', '');

  await frame.getByText('plain link').click();
  await page.waitForTimeout(1000);

  expect(dialogs).toEqual([]);
  await expect(page).toHaveURL(`${INBOX_PATH}/${message.mailboxMessageId}`);
  await expect(frame.getByText('Formatted hello')).toBeVisible();
});

test('accepting the same message twice produces one case, one acknowledgement, one forward', async ({
  page,
  request,
}) => {
  const message = await arrive(page, request, 'Assay method clarification — Metformin HCl');

  await decideInUi(page, message.mailboxMessageId, 'accept');
  await expect
    .poll(persistedState, { timeout: 60_000 })
    .toEqual(ACCEPTED_STATE);

  const [firstCase] = await readQueryCases();

  const second = await acceptViaApi(request, message.mailboxMessageId);
  expect(second.created).toBe(false);
  expect(second.alreadyDecided).toBe(true);
  expect(second.queryId).toBe(firstCase.queryId);

  expect(await persistedState()).toEqual(ACCEPTED_STATE);

  const cases = await readQueryCases();
  expect(cases).toHaveLength(1);
  expect(cases[0].queryId).toBe(firstCase.queryId);

  const [counter] = await readQueryCounters({ key: 'counters' });
  expect(counter.value.QRY).toBe(1);

  expect(second.aiSummaryStatus).toBe('FALLBACK');
  expect(cases[0].aiSummary).toMatchObject({
    status: 'FALLBACK',
    fallback: true,
    aiGenerated: false,
  });
  expect(
    await readAuditEvents({ queryId: firstCase.queryId, action: 'AI_SUMMARY_GENERATED' }),
  ).toHaveLength(1);
});
