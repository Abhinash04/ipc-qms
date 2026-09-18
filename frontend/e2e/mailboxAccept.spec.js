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

/**
 * The Front Office validation gate, end to end.
 *
 * Every assertion here is made against MongoDB rather than against the screen.
 * The UI saying "Query case QRY-… created" is a claim; the case, the two
 * outbound emails and the decision record are the evidence, and they are what
 * the next stage of the workflow actually reads.
 */

/**
 * An external enquirer. `.example` is reserved by RFC 2606 and can never
 * receive mail, so this suite cannot reach a real mailbox even if the transport
 * were misconfigured. Nothing about it is read from the environment — the point
 * of the first assertion is that the case records *the sender*, not whatever
 * address the deployment happens to have configured.
 */
const SENDER = 'Ravi Kumar <ravi@pharma.example>';
const SENDER_EMAIL = 'ravi@pharma.example';

/** ROLE_SLUG[FRONT_OFFICE] + SECTIONS.INBOX.segment — frontend/src/constants. */
const INBOX_PATH = '/front-officer/inbox';

/** mintIds() in acceptMessage.js labels the id with the UTC year. */
const currentYear = () => new Date().getUTCFullYear();

/**
 * Click ✓ or ✗ on one row and confirm.
 *
 * Both buttons carry an accessible name that includes the mailbox message id,
 * and both swap the row's controls for an inline "Yes" — only ever one at a
 * time, because the page tracks a single `{ id, action }` confirmation.
 */
async function decideInUi(page, mailboxMessageId, action) {
  const verb = action === 'accept' ? 'Accept' : 'Reject';
  await page
    .getByRole('button', { name: `${verb} message ${mailboxMessageId}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
}

/** Everything the accept path is supposed to have written, in one read. */
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

/** Put one message in the mailbox and open the inbox, signed in to both sides. */
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
  // The enquirer is whoever wrote in — never a configured stakeholder address.
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
  // Not just "no acknowledgement" — a rejection writes no email record at all.
  expect(await readEmailMessages()).toHaveLength(0);

  const [decision] = await readMailboxDecisions();
  expect(decision.mailboxMessageId).toBe(message.mailboxMessageId);
  expect(decision.queryId).toBeNull();
});

test('accepting the same message twice produces one case, one acknowledgement, one forward', async ({
  page,
  request,
}) => {
  const message = await arrive(page, request, 'Assay method clarification — Metformin HCl');

  await decideInUi(page, message.mailboxMessageId, 'accept');

  // Settle completely before the second attempt: overlapping the two would test
  // concurrency, which is not what this case is about.
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

  // The id sequence was not advanced either — the second accept returned from
  // the stored decision without minting anything.
  const [counter] = await readQueryCounters({ key: 'counters' });
  expect(counter.value.QRY).toBe(1);

  /**
   * Nor was the enquiry summarised a second time.
   *
   * GEMMA_API_URL is empty under .env.e2e, so the summary is the deterministic
   * stand-in and says so — a FALLBACK presented as the model's work would be
   * worse than no summary. `isUsable` in acceptMessage.js counts a FALLBACK as
   * a summary we already have, so the retry reuses it: one stored summary, one
   * AI_SUMMARY_GENERATED row, no second model call.
   *
   * The other branch — `status: 'FAILED'`, which a retry *would* re-summarise —
   * is deliberately not asserted here, because it cannot be produced from
   * outside the process. `gemmaService.generateSummary` catches every network,
   * timeout, non-2xx and parse failure and returns the fallback, so no value of
   * GEMMA_API_URL (empty, unroutable, or a host that refuses) makes it throw,
   * and only a throw reaches the FAILED branch. The backend's own suite covers
   * it by replacing the function
   * (backend/src/test/acceptMessage.test.js — `vi.spyOn(gemmaService,
   * 'generateSummary').mockRejectedValue(...)`), which an out-of-process run
   * has no equivalent of.
   */
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
