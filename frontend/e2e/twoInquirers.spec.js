import { test, expect } from '@playwright/test';

import { OFFICER_IN_CHARGE_USER, signInAs } from './helpers/api.js';
import {
  closeDb,
  readEmailMessages,
  readQueryCases,
  resetDatabase,
} from './helpers/db.js';
import {
  POLL,
  approvalPath,
  arrive,
  accept,
  assign,
  auditTrail,
  caseById,
  currentYear,
  draftAndSubmit,
  only,
  review,
  stateOf,
} from './helpers/workflow.js';

/**
 * Two strangers write to the same Front Office mailbox, and each gets their own
 * answer.
 *
 * This is the live test that went wrong, reproduced against real server code:
 * two external enquirers mailed one mailbox, both cases were created, and one
 * of them received the other's fate — a final response delivered three times,
 * an acknowledgement that needed a manual retry. What is asserted here is the
 * thing that must hold however the two cases interleave: each case carries its
 * own inquirer from the From header it arrived on, and each ends with exactly
 * one acknowledgement and one response addressed to that person and to nobody
 * else.
 *
 * The two are deliberately **interleaved** rather than run one after the other
 * — A to review, then B all the way to closure, then A. Sequential cases share
 * no state worth testing; concurrent ones share the Case ID counter, the
 * mailbox, the outbound ledger and the Front Office session.
 */

/** `.example` is reserved by RFC 2606 and can never receive mail. */
const ABHINASH = {
  from: 'Abhinash Pritiraj <abhinash@pharma.example>',
  email: 'abhinash@pharma.example',
  name: 'Abhinash Pritiraj',
  subject: 'Clarification on monograph revision and impurity limits',
  body: 'Please confirm which revision of the monograph applies to our submission.',
};

const SHEKHAR = {
  from: 'Shekhar Verma <shekhar@labs.example>',
  email: 'shekhar@labs.example',
  name: 'Shekhar Verma',
  subject: 'Residual solvent limits for a Class 2 solvent',
  body: 'We are seeking the applicable residual solvent limit and the test method.',
};

const enquiryOf = (person) => ({
  from: person.from,
  subject: person.subject,
  body: person.body,
});

/** Every outbound email of one type on one case. */
const mailOf = (queryId, emailType) => readEmailMessages({ queryId, emailType });

/**
 * One case, closed, with exactly one of each email and nothing addressed to
 * anybody but the person who wrote in.
 */
async function expectAnsweredOnce(queryId, person, other) {
  const row = await caseById(queryId);
  expect(row.workflowState).toBe('CLOSED');
  expect(row.businessStatus).toBe('CLOSED');
  expect(row.inquirer.email).toBe(person.email);
  expect(row.inquirer.name).toBe(person.name);

  const acknowledgements = await mailOf(queryId, 'ACKNOWLEDGEMENT');
  const responses = await mailOf(queryId, 'OUTGOING_RESPONSE');
  const forwards = await mailOf(queryId, 'FORWARD');

  expect(acknowledgements).toHaveLength(1);
  expect(responses).toHaveLength(1);
  expect(forwards).toHaveLength(1);

  expect(acknowledgements[0].to).toEqual([person.email]);
  expect(responses[0].to).toEqual([person.email]);
  expect(responses[0].subject).toContain(queryId);

  // The other inquirer's address appears nowhere on this case — not on the
  // acknowledgement, not on the answer, not in the body of either.
  const everything = await readEmailMessages({ queryId });
  for (const mail of everything) {
    expect([mail.to, mail.cc, mail.bcc].flat().filter(Boolean)).not.toContain(other.email);
  }

  const trail = await auditTrail(queryId);
  expect(trail.filter((action) => action === 'ACKNOWLEDGEMENT_SENT')).toHaveLength(1);
  expect(trail.filter((action) => action === 'RESPONSE_DISPATCHED')).toHaveLength(1);
  expect(trail.filter((action) => action === 'QUERY_CLOSED')).toHaveLength(1);
  expect(only(trail, ['FINAL_APPROVAL_GRANTED', 'RESPONSE_DISPATCHED', 'QUERY_CLOSED'])).toEqual([
    'FINAL_APPROVAL_GRANTED',
    'RESPONSE_DISPATCHED',
    'QUERY_CLOSED',
  ]);
}

/** Approve, and wait for the case to close with its answer sent. */
async function approveAndClose(page, queryId) {
  await signInAs(page, OFFICER_IN_CHARGE_USER.email);
  await page.goto(approvalPath(queryId));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect
    .poll(async () => {
      const row = await caseById(queryId);
      const responses = await mailOf(queryId, 'OUTGOING_RESPONSE');
      return row && { state: row.workflowState, responses: responses.length };
    }, POLL)
    .toEqual({ state: 'CLOSED', responses: 1 });
}

test.beforeEach(async () => {
  await resetDatabase();
});

test.afterAll(async () => {
  await closeDb();
});

test('two inquirers, one mailbox: two cases that never touch each other', async ({
  page,
  request,
}) => {
  // Two full lifecycles, nine sign-ins, every route chunk cold on first use.
  test.setTimeout(600_000);

  // ── Both enquiries arrive before either is accepted ───────────────────────
  //
  // Which is how it happened: the Front Officer opened the inbox to two
  // messages, not to one.
  const firstMail = await arrive(request, enquiryOf(ABHINASH));
  const secondMail = await arrive(request, enquiryOf(SHEKHAR));

  const first = await accept(page, firstMail);
  const second = await accept(page, secondMail);

  expect(await readQueryCases()).toHaveLength(2);
  expect(first.queryId).toBe(`QRY-${currentYear()}-00001`);
  expect(second.queryId).toBe(`QRY-${currentYear()}-00002`);
  expect(first.queryId).not.toBe(second.queryId);

  // Each case carries the address its own mail arrived from.
  expect(first.inquirer.email).toBe(ABHINASH.email);
  expect(second.inquirer.email).toBe(SHEKHAR.email);

  // And each was acknowledged once, to that address — the step that needed a
  // manual retry in the live run.
  for (const [row, person] of [
    [first, ABHINASH],
    [second, SHEKHAR],
  ]) {
    const acknowledgements = await mailOf(row.queryId, 'ACKNOWLEDGEMENT');
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0].to).toEqual([person.email]);
  }

  const a = first.queryId;
  const b = second.queryId;

  // ── Interleaved from here ─────────────────────────────────────────────────
  await assign(page, a);
  await assign(page, b);

  await draftAndSubmit(page, a);
  await draftAndSubmit(page, b);

  // A reaches review and waits there while B is carried all the way out.
  await review(page, a);
  expect(await stateOf(a)).toBe('PENDING_FINAL_APPROVAL');

  await review(page, b);
  await approveAndClose(page, b);

  // Closing B changed nothing about A: still approved, still unanswered.
  expect(await stateOf(a)).toBe('PENDING_FINAL_APPROVAL');
  expect(await mailOf(a, 'OUTGOING_RESPONSE')).toHaveLength(0);

  await approveAndClose(page, a);

  // ── Both answered, once each, to the right person ─────────────────────────
  await expectAnsweredOnce(a, ABHINASH, SHEKHAR);
  await expectAnsweredOnce(b, SHEKHAR, ABHINASH);

  // Each answer carries its own case's approved draft, not the other's.
  const [answerToFirst] = await mailOf(a, 'OUTGOING_RESPONSE');
  const [answerToSecond] = await mailOf(b, 'OUTGOING_RESPONSE');
  expect(answerToFirst.body).not.toBe(answerToSecond.body);
  expect(answerToFirst.subject).toContain(ABHINASH.subject);
  expect(answerToSecond.subject).toContain(SHEKHAR.subject);

  // Nothing was created beyond the two cases.
  expect(await readQueryCases()).toHaveLength(2);
});
