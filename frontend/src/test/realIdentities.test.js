import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import * as mailboxService from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';
import { fakeFinalApprovalEndpoint } from '@/test/fakeFinalApprovalEndpoint';
import { EXTERNAL_INQUIRER } from '@/test/externalInquirer';
import { findUserById, MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';
import { fakeCaseMail } from '@/test/fakeCaseMail';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const ABHINASH = EXTERNAL_INQUIRER;
const BHUMIKA = findUserById('USR-0002');
const JATIN = findUserById('USR-0003');
const NEHA = findUserById('USR-0004');
const RAWAT = findUserById('USR-0009');

function incomingEnquiry(overrides = {}) {
  return {
    mailboxMessageId: '18f2a1b2c3d4e5f6',
    providerMessageId: '18f2a1b2c3d4e5f6',
    providerThreadId: '18f2a1b2c3d4e5f6',
    to: BHUMIKA.email,
    from: `${ABHINASH.name} <${ABHINASH.email}>`,
    subject: 'Clarification on monograph revision and impurity limits',
    body: '1. Product specifications\n2. Applicable monograph\n3. Analytical documentation',
    receivedAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * The forward is a server call now: the record of it, the audit row and the
 * move to PENDING_ASSIGNMENT all come back from the endpoint rather than being
 * written here. See src/test/fakeCaseMail.js.
 */
const caseMail = fakeCaseMail();
const fakeForward = caseMail.forwardQuery;

/**
 * The Front Office's retry is `POST /emails/response` — the whole send, named
 * by case. Final approval's send is the mail leg *inside* the endpoint, which
 * is handed a composed message. They are different seams and take different
 * arguments; this is the retry one.
 */
const fakeResponse = caseMail.sendResponse;

const fakeMailLeg = ({ to, subject, body }) =>
  Promise.resolve({
    from: BHUMIKA.email,
    to: [to].flat(),
    subject,
    body,
    providerMessageId: 'fake-response-id',
    sentAt: '2026-08-19T10:00:00.000Z',
  });

/**
 * Final approval is one server call now, so the mail leg is injected into the
 * endpoint rather than into the store — see src/test/fakeFinalApprovalEndpoint.js.
 * Jatin is the approver on this path, and the server reads that actor off the
 * session rather than taking it from the client.
 */
const finalApproval = (send = fakeMailLeg) =>
  fakeFinalApprovalEndpoint({ send, actor: JATIN.name });

/**
 * Bhumika's mailbox acknowledges Abhinash — a server call now, so this asks the
 * endpoint and re-reads the case exactly as the store does. The addresses the
 * assertions check are the server's choice: the Front Office mailbox it sends
 * from, and the inquirer stored on the case at intake.
 */
async function acknowledge(queryId) {
  const result = await caseMail.sendAcknowledgement({ queryId });
  await s().refreshFromServer();
  return result;
}

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

/**
 * The seeded directory.
 *
 * This described "the real identities" while two accounts carried named
 * individuals' personal Gmail addresses, and pinned those addresses so they
 * could not drift. They are gone: every account is on the reserved
 * `@ipc.example` domain, and the assertions below pin that instead — which is
 * now the property worth defending, because it is the one that keeps personal
 * data out of the repository and stops a sign-in identity doubling as somebody's
 * private inbox.
 */
describe('the seeded directory', () => {
  it('holds Bhumika and Jatin as the Front Office and Officer-in-Charge', () => {
    expect(BHUMIKA).toMatchObject({ role: ROLES.FRONT_OFFICE, email: 'bhumika.makker@ipc.example' });
    expect(JATIN).toMatchObject({ role: ROLES.OFFICER_IN_CHARGE, email: 'jatin.rawat@ipc.example' });
  });

  it('holds no account for the inquirer — they email in and never sign in', () => {
    expect(MOCK_USERS.some((u) => u.email === ABHINASH.email)).toBe(false);
    expect(ABHINASH.id).toBeNull();
  });

  it('holds Rawat Jatin as an Assigned Official, distinct from the OIC', () => {
    expect(RAWAT).toMatchObject({ id: 'USR-0009', role: ROLES.ASSIGNED_OFFICIAL });
    expect(RAWAT.email).toBe('rawat.jatin@ipc.example');
  });

  it('gives every Assigned Official expertise', () => {
    const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

    expect(officials.length).toBeGreaterThanOrEqual(5);
    for (const official of officials) {
      expect(official.expertise?.length, `${official.name} needs expertise`).toBeGreaterThan(0);
    }
  });

  it('keeps Rawat Jatin and Jatin Rawat as different people', () => {

    expect(RAWAT.id).not.toBe(JATIN.id);
    expect(RAWAT.email).not.toBe(JATIN.email);
    expect(RAWAT.role).not.toBe(JATIN.role);

    const addresses = MOCK_USERS.map((u) => u.email.toLowerCase());
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  /**
   * The rule the whole file exists for now: not one address in the directory can
   * receive mail. `@ipc.example` is reserved by RFC 2606, so an account that
   * acquires a routable address — a real colleague's, or a real IPC one — fails
   * here rather than at the first send.
   */
  it('puts every account on a reserved, unroutable domain', () => {
    expect(MOCK_USERS.length).toBeGreaterThan(0);
    for (const user of MOCK_USERS) {
      expect(user.email, `${user.name} must stay unroutable`).toMatch(/@ipc\.example$/);
    }
  });

  it('offers the AI several officials to choose between', () => {
    const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);
    expect(officials.length).toBeGreaterThanOrEqual(5);

    expect(new Set(officials.map((u) => u.divisionId)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('1–3. Abhinash → Bhumika creates one stable Query Case', () => {
  it('creates the case from the incoming email, linked to the provider ids', () => {
    const { queryId, threadId, created } = s().ingestEmail(incomingEnquiry());

    expect(created).toBe(true);
    expect(queryId).toBe('QRY-2026-00001');

    const query = s().getQuery(queryId);
    const message = s().emailMessages.find((m) => m.messageId === query.sourceEmailId);

    expect(query.threadId).toBe(threadId);
    expect(query.inquirer.email).toBe(ABHINASH.email);
    expect(query.inquirer.id).toBeNull();
    expect(message.sourceMessageId).toBe('18f2a1b2c3d4e5f6');
    expect(message.providerThreadId).toBe('18f2a1b2c3d4e5f6');
    expect(message.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(message.to).toEqual([BHUMIKA.email]);
  });

  it('keeps the same Query ID when the same mail is polled again', () => {
    const first = s().ingestEmail(incomingEnquiry());
    const second = s().ingestEmail(incomingEnquiry());
    const third = s().ingestEmail(incomingEnquiry());

    expect(second).toMatchObject({ queryId: first.queryId, created: false });
    expect(third.queryId).toBe(first.queryId);
    expect(s().queries).toHaveLength(1);
  });

  it('keeps the same Query ID across a reload', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    await new Promise((r) => setTimeout(r, 60));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], emailMessages: [], emailThreads: [], auditEvents: [],
      workflowSteps: [], reviews: [], responseVersions: [], notifications: [],
    });
    await s().hydrate();

    expect(s().queries.map((q) => q.queryId)).toEqual([queryId]);
    expect(s().ingestEmail(incomingEnquiry()).created).toBe(false);
    expect(s().queries).toHaveLength(1);
  });
});

describe('4. Bhumika acknowledges Abhinash on the same thread', () => {
  it('records the acknowledgement as sent by Bhumika, to Abhinash', async () => {
    const { queryId, threadId } = s().ingestEmail(incomingEnquiry());
    const outcome = await acknowledge(queryId);

    const ack = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT);

    expect(outcome.outcome).toBe('SENT');
    expect(ack.from).toContain(BHUMIKA.email);
    expect(ack.to).toEqual([ABHINASH.email]);
    expect(ack.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(ack.threadId).toBe(threadId);
    expect(ack.queryId).toBe(queryId);
  });

  it('does not create another Query Case', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    await acknowledge(queryId);
    await acknowledge(queryId);

    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
  });
});

describe('5–6. Bhumika forwards to Jatin, same case throughout', () => {
  it('sends the forward from Bhumika to Jatin on the same thread', async () => {
    const { queryId, threadId } = s().ingestEmail(incomingEnquiry());
    await acknowledge(queryId);
    s().verifyQuery(queryId, BHUMIKA);

    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const forward = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.FORWARD);
    expect(forward.from).toContain(BHUMIKA.email);
    expect(forward.to).toEqual([JATIN.email]);
    expect(forward.threadId).toBe(threadId);
    expect(forward.subject).toContain(queryId);
    expect(forward.body).toContain('monograph');
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('records who forwarded to whom in the audit trail', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const entry = s()
      .getAudit(queryId)
      .find((a) => a.event === AUDIT_EVENT.QUERY_FORWARDED);

    /**
     * Who forwarded is the audit actor; to whom is the address on the email the
     * server actually sent. The details line no longer repeats either, because
     * the server writes it and a name copied into prose can disagree with the
     * row it describes.
     */
    expect(entry.actor).toBe(BHUMIKA.name);
    expect(entry.details).toContain('Officer-in-Charge');

    const forwarded = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
    );
    expect(forwarded.to).toEqual([JATIN.email]);
  });

  it('7. forwarding never creates a second Query Case', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    expect(s().queries.map((q) => q.queryId)).toEqual([queryId]);
  });

  it('7. a reply on the same provider thread attaches instead of creating QRY-2026-00002', () => {
    const { queryId, threadId } = s().ingestEmail(incomingEnquiry());

    const reply = s().ingestEmail(
      incomingEnquiry({
        mailboxMessageId: '18f2a1b2c3d4e5f7',
        providerMessageId: '18f2a1b2c3d4e5f7',
        subject: 'Re: Clarification on monograph revision and impurity limits',
        body: 'One more point, please.',
        receivedAt: '2026-08-18T11:00:00.000Z',
      }),
    );

    expect(reply).toMatchObject({ queryId, created: false, reason: 'attached-to-thread' });
    expect(s().queries).toHaveLength(1);

    const onThread = s().emailMessages.filter((m) => m.threadId === threadId);
    expect(onThread).toHaveLength(2);
    expect(onThread[1].body).toBe('One more point, please.');
  });

  it('7. a genuinely different enquiry still gets its own case', () => {
    const first = s().ingestEmail(incomingEnquiry());
    const other = s().ingestEmail(
      incomingEnquiry({
        mailboxMessageId: 'aaaa1111',
        providerMessageId: 'aaaa1111',
        providerThreadId: 'bbbb2222',
        subject: 'Unrelated enquiry about training workshops',
      }),
    );

    expect(other.created).toBe(true);
    expect(other.queryId).not.toBe(first.queryId);
    expect(s().queries.map((q) => q.queryId)).toEqual(['QRY-2026-00001', 'QRY-2026-00002']);
  });
});

describe('8. RBAC for Bhumika and Jatin', () => {
  it('lets Bhumika verify and forward, but not assign', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());

    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    expect(() => s().assignQuery(queryId, NEHA.id, BHUMIKA)).toThrow(/may not perform ASSIGN/);
  });

  it('lets Jatin assign, but not verify or forward', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());

    expect(() => s().verifyQuery(queryId, JATIN)).toThrow(/may not perform VERIFY/);

    s().verifyQuery(queryId, BHUMIKA);
    await expect(s().forwardToOic(queryId, JATIN, fakeForward)).rejects.toThrow(
      /may not perform FORWARD/,
    );
  });

  it('refuses Abhinash any action on his own case', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());

    expect(() => s().verifyQuery(queryId, ABHINASH)).toThrow(/may not perform VERIFY/);
    await expect(s().forwardToOic(queryId, ABHINASH, fakeForward)).rejects.toThrow();
  });
});

describe('9–10. Jatin assigns a mock official and the mocked tail completes', () => {
  it('offers an advisory recommendation that Jatin is free to override', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const recommendation = s().recommendAssigneeFor(queryId);
    expect(recommendation.userId).toBeTruthy();
    expect(findUserById(recommendation.userId).role).toBe(ROLES.ASSIGNED_OFFICIAL);

    expect(s().getQuery(queryId).currentAssigneeId).toBeNull();
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);

    s().assignQuery(queryId, NEHA.id, JATIN);
    expect(s().getQuery(queryId).currentAssigneeId).toBe(NEHA.id);
  });

  it('runs to CLOSED with the mocked tail, keeping one Query ID and the real identities', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    await acknowledge(queryId);

    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);
    s().assignQuery(queryId, NEHA.id, JATIN);

    await s().generateAiDraft(queryId, NEHA);
    s().addReviewLevel(queryId, 'USR-0005', NEHA);
    s().addReviewLevel(queryId, 'USR-0006', NEHA);
    s().submitForReview(queryId, NEHA);
    s().approveReview(queryId, 'Reviewer I approves', findUserById('USR-0005'));
    s().approveReview(queryId, 'Reviewer II approves', findUserById('USR-0006'));

    await s().grantFinalApproval(queryId, JATIN, finalApproval());

    expect(s().queries.map((q) => q.queryId)).toEqual([queryId]);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);

    const actors = s().getAudit(queryId).map((a) => a.actor);
    expect(actors).toContain(BHUMIKA.name);
    expect(actors).toContain(JATIN.name);

    const thread = s().emailMessages.filter((m) => m.queryId === queryId);
    expect(thread.map((m) => m.emailType)).toEqual([
      EMAIL_TYPE.INCOMING_QUERY,
      EMAIL_TYPE.ACKNOWLEDGEMENT,
      EMAIL_TYPE.FORWARD,
      EMAIL_TYPE.OUTGOING_RESPONSE,
    ]);
    expect(new Set(thread.map((m) => m.threadId)).size).toBe(1);

    const response = thread.at(-1);
    expect(response.to).toEqual([ABHINASH.email]);
    expect(response.from).toContain(BHUMIKA.email);
  });

  it('a failed forward leaves the case where it was, for retry', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    s().verifyQuery(queryId, BHUMIKA);

    const failing = () => Promise.reject(new Error('mail send failed'));
    await expect(s().forwardToOic(queryId, BHUMIKA, failing)).rejects.toThrow(/mail send failed/);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(0);
  });
});

/**
 * Intake is a gate, not a pipeline.
 *
 * This suite used to assert that one email registered, acknowledged, verified
 * AND forwarded itself with nobody involved. The gate is still the point: mail
 * arriving changes nothing until Bhumika accepts it. What accepting then does
 * is no longer split across two clicks — it is one server call that registers,
 * acknowledges and forwards, and the browser orchestrates none of it.
 */
describe('intake — mail waits for the Front Officer', () => {
  function mockMailbox({ forwardFails = false } = {}) {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({
      messages: [incomingEnquiry()],
    });
    vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
    vi.mocked(mailboxService.recordMailboxDecision).mockResolvedValue({ alreadyDecided: false });
    vi.mocked(mailboxService.sendAcknowledgement).mockImplementation(caseMail.sendAcknowledgement);
    // The whole intake sequence lives behind this one endpoint now. With the mailbox
    // down its forward step fails on its own: the case is still created and
    // acknowledged, and is left at FRONT_OFFICE_VERIFICATION for a retry.
    vi.mocked(mailboxService.acceptMailboxMessage).mockImplementation(
      fakeAcceptEndpoint(
        forwardFails
          ? { forwarded: false, errors: [{ step: 'forward', error: 'mail send failed' }] }
          : {},
      ),
    );
    vi.mocked(mailboxService.forwardQuery).mockImplementation(
      forwardFails
        ? () => Promise.reject(new Error('mail send failed'))
        : (payload) => fakeForward(payload),
    );
  }

  /** What the background poll does: look, and report. Nothing else. */
  async function checkMailbox() {
    useAuthStore.setState({ currentUser: BHUMIKA });
    const { result } = renderHook(() => useMailboxIngestion());
    let outcome;
    await act(async () => {
      outcome = await result.current.checkMailbox();
    });
    return outcome;
  }

  /** What the tick does. */
  async function acceptEnquiry() {
    useAuthStore.setState({ currentUser: BHUMIKA });
    const { result } = renderHook(() => useMailboxIngestion());
    let outcome;
    await act(async () => {
      outcome = await result.current.accept(incomingEnquiry());
    });
    return outcome;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates nothing when mail merely arrives', async () => {
    mockMailbox();
    const outcome = await checkMailbox();

    expect(outcome.fetched).toBe(1);
    expect(s().queries).toHaveLength(0);
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
    expect(mailboxService.forwardQuery).not.toHaveBeenCalled();
  });

  it('registers, acknowledges and forwards on accept — one click, one request', async () => {
    mockMailbox();
    const outcome = await acceptEnquiry();

    expect(outcome.accepted).toBe(true);
    expect(outcome.queryId).toBe('QRY-2026-00001');
    expect(outcome.acknowledged).toBe(true);
    expect(outcome.forwarded).toBe(true);

    // Accepting used to stop here so Bhumika could forward separately. It was
    // never a second judgement — every accepted enquiry goes to Jatin — and the
    // gap left a case sitting where nobody had been told about it.
    expect(s().getQuery('QRY-2026-00001').workflowState).toBe(
      WORKFLOW_STATE.PENDING_ASSIGNMENT,
    );
    // And the browser drives none of the sequence: no mail, no decision call.
    expect(mailboxService.forwardQuery).not.toHaveBeenCalled();
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
    expect(mailboxService.recordMailboxDecision).not.toHaveBeenCalled();
  });

  it('adds nothing to the intake history — it shows what the server recorded', async () => {
    mockMailbox();
    await acceptEnquiry();

    // The accept endpoint writes this trail against the Front Officer's own
    // session. This tab used to mint its own QUERY_RECEIVED and
    // AI_SUMMARY_GENERATED here and must now add nothing at all. The order, and
    // Bhumika as the acting officer, are asserted in
    // backend/src/test/acceptMessage.test.js.
    expect(s().getAudit('QRY-2026-00001').map((a) => a.event)).toEqual([
      AUDIT_EVENT.QUERY_RECEIVED,
      AUDIT_EVENT.QUERY_REGISTERED,
      AUDIT_EVENT.ACKNOWLEDGEMENT_SENT,
      AUDIT_EVENT.QUERY_FORWARDED,
    ]);
  });

  it('puts the enquiry, its acknowledgement and the forward on one case and one thread', async () => {
    mockMailbox();
    await acceptEnquiry();

    const query = s().getQuery('QRY-2026-00001');
    const thread = s().emailMessages.filter((m) => m.queryId === query.queryId);

    // Three messages, not two: the forward belongs to the same accept.
    expect(thread.map((m) => m.emailType)).toEqual([
      EMAIL_TYPE.INCOMING_QUERY,
      EMAIL_TYPE.ACKNOWLEDGEMENT,
      EMAIL_TYPE.FORWARD,
    ]);
    expect(new Set(thread.map((m) => m.threadId))).toEqual(new Set([query.threadId]));

    expect(thread[0].to).toEqual([BHUMIKA.email]);
    // The acknowledgement goes back to whoever wrote in; the forward to Jatin.
    expect(thread[1].to).toEqual([ABHINASH.email]);
    expect(thread[2].to).toEqual([JATIN.email]);
    expect(s().queries).toHaveLength(1);
  });

  it('forwards to the Officer-in-Charge as part of accepting, not on a second click', async () => {
    mockMailbox();
    await acceptEnquiry();

    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(1);
    expect(s().getQuery('QRY-2026-00001').workflowState).toBe(
      WORKFLOW_STATE.PENDING_ASSIGNMENT,
    );

    // The second click went with the second judgement: FORWARD is valid only at
    // FRONT_OFFICE_VERIFICATION, so a case the server already forwarded cannot
    // be forwarded again from here.
    await expect(s().forwardToOic('QRY-2026-00001', BHUMIKA)).rejects.toThrow(
      /may not perform FORWARD/,
    );
    expect(mailboxService.forwardQuery).not.toHaveBeenCalled();
  });

  it('keeps the case at verification when the forward email fails', async () => {
    mockMailbox({ forwardFails: true });
    const outcome = await acceptEnquiry();

    // The forward is the one step of the accept that can fail without losing
    // anything: the case exists, Abhinash was told, and what is left is the
    // retry the case page offers.
    expect(outcome.accepted).toBe(true);
    expect(outcome.forwarded).toBe(false);
    expect(outcome.errors).toEqual([{ step: 'forward', error: 'mail send failed' }]);

    await expect(s().forwardToOic('QRY-2026-00001', BHUMIKA)).rejects.toThrow(
      /mail send failed/,
    );

    const query = s().getQuery('QRY-2026-00001');
    expect(query.workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(0);
  });

  it('accepting the same enquiry twice changes nothing', async () => {
    mockMailbox();
    await acceptEnquiry();
    const second = await acceptEnquiry();

    // The browser does not dedupe: it sends the second accept too, and the
    // server answers it from the decision it already stored. That this leaves
    // one case, one acknowledgement and one forward is asserted in
    // backend/src/test/acceptMessage.test.js.
    expect(mailboxService.acceptMailboxMessage).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({
      accepted: false,
      alreadyDecided: true,
      queryId: 'QRY-2026-00001',
    });
    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
  });
});

describe('the inquirer device does not matter', () => {
  it('treats desktop and mobile as the same inquirer on the same thread', () => {
    const { queryId } = s().ingestEmail(incomingEnquiry());

    const fromPhone = s().ingestEmail(
      incomingEnquiry({
        mailboxMessageId: 'mobile-msg-1',
        providerMessageId: 'mobile-msg-1',
        body: 'Sent from my iPhone — one more detail.',
      }),
    );

    expect(fromPhone).toMatchObject({ queryId, created: false, reason: 'attached-to-thread' });
    expect(s().queries).toHaveLength(1);
  });

  it('opens a second case for a genuinely new enquiry from the same person', () => {
    const first = s().ingestEmail(incomingEnquiry());
    const second = s().ingestEmail(
      incomingEnquiry({
        mailboxMessageId: 'mobile-msg-2',
        providerMessageId: 'mobile-msg-2',
        providerThreadId: 'a-different-thread',
        subject: 'A separate question about training workshops',
      }),
    );

    expect(second.created).toBe(true);
    expect(second.queryId).not.toBe(first.queryId);
    expect(s().queries.map((q) => q.queryId)).toEqual(['QRY-2026-00001', 'QRY-2026-00002']);
  });

  it('resolves the inquirer from the email address, not from any session', () => {

    useAuthStore.setState({ currentUser: null });
    const { queryId } = s().ingestEmail(incomingEnquiry());

    const query = s().getQuery(queryId);
    expect(query.inquirer.id).toBeNull();
    expect(query.inquirer.email).toBe(ABHINASH.email);
  });
});

describe('final approval dispatches automatically', () => {

  async function readyForApproval() {
    const { queryId } = s().ingestEmail(incomingEnquiry());
    await acknowledge(queryId);
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);
    s().assignQuery(queryId, NEHA.id, JATIN);
    await s().generateAiDraft(queryId, NEHA);
    s().saveDraftVersion(queryId, 'The approved wording.', NEHA);
    s().addReviewLevel(queryId, 'USR-0005', NEHA);
    s().addReviewLevel(queryId, 'USR-0006', NEHA);
    s().submitForReview(queryId, NEHA);
    s().approveReview(queryId, 'Reviewer I approves', findUserById('USR-0005'));
    s().approveReview(queryId, 'Reviewer II approves', findUserById('USR-0006'));
    return queryId;
  }

  const failing = () => Promise.reject(new Error('mail send failed'));

  it('1–2. approval alone takes the case from READY_FOR_DISPATCH to CLOSED', async () => {
    const queryId = await readyForApproval();

    await s().grantFinalApproval(queryId, JATIN, finalApproval());

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
  });

  it('3–5. sends from Bhumika to Abhinash on the existing case and thread', async () => {
    const queryId = await readyForApproval();
    const threadId = s().getQuery(queryId).threadId;

    await s().grantFinalApproval(queryId, JATIN, finalApproval());

    const sent = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE);
    expect(sent.from).toContain(BHUMIKA.email);
    expect(sent.to).toEqual([ABHINASH.email]);
    expect(sent.queryId).toBe(queryId);
    expect(sent.threadId).toBe(threadId);
    expect(sent.body).toBe('The approved wording.');
    expect(s().queries).toHaveLength(1);
  });

  it('7. a failed send leaves the case approved but NOT closed', async () => {
    const queryId = await readyForApproval();

    /**
     * The endpoint reports a failed send instead of throwing it. Approval is a
     * decision a person made, and it has to survive a mail server being down —
     * so the approval is recorded first and the case is left exactly where the
     * Front Office retry acts on it. What must never happen is the case reading
     * CLOSED while the inquirer received nothing, which is asserted below by
     * the absence of an OUTGOING_RESPONSE alongside the state.
     */
    const outcome = await s().grantFinalApproval(queryId, JATIN, finalApproval(failing));

    expect(outcome.approved).toBe(true);
    expect(outcome.dispatched).toBe(false);
    expect(outcome.workflowState).toBe(WORKFLOW_STATE.READY_FOR_DISPATCH);
    expect(outcome.errors.map((e) => e.error).join(' ')).toMatch(/mail send failed/);

    const query = s().getQuery(queryId);
    expect(query.workflowState).toBe(WORKFLOW_STATE.READY_FOR_DISPATCH);
    expect(query.workflowState).not.toBe(WORKFLOW_STATE.CLOSED);

    const approved = s().getVersions(queryId).find((v) => v.status === 'FINAL_APPROVED');
    expect(approved).toBeTruthy();
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(0);
  });

  it('8. a retry after a failure dispatches successfully', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, finalApproval(failing)).catch(() => {});

    const outcome = await s().dispatchResponse(queryId, BHUMIKA, fakeResponse);

    expect(outcome.dispatched).toBe(true);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(1);
  });

  it('9. repeated triggers never send a second response', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, finalApproval());

    /**
     * The guard moved to the server, so these presses do reach it — and are
     * answered "already sent" rather than sending again. That answer is the
     * point: the browser no longer decides, and cannot decide wrongly from a
     * stale copy of the case.
     */
    const sendAgain = vi.fn(fakeResponse);
    const second = await s().dispatchResponse(queryId, null, sendAgain);
    const third = await s().dispatchResponse(queryId, null, sendAgain);

    expect(second).toMatchObject({ dispatched: false, alreadyDispatched: true, outcome: 'ALREADY_SENT' });
    expect(third.outcome).toBe('ALREADY_SENT');
    expect(sendAgain).toHaveBeenCalledTimes(2);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(1);
  });

  it('9. survives a reload — the guard is persisted, not in memory', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, finalApproval());
    await new Promise((r) => setTimeout(r, 60));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], emailMessages: [], emailThreads: [], auditEvents: [],
      workflowSteps: [], reviews: [], responseVersions: [], notifications: [],
    });
    await s().hydrate();

    const sendAgain = vi.fn(fakeResponse);
    const retry = await s().dispatchResponse(queryId, null, sendAgain);

    expect(retry.outcome).toBe('ALREADY_SENT');
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(1);
  });

  it('10. the response appears in the thread and the audit trail', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, finalApproval());

    const thread = s().emailMessages.filter((m) => m.queryId === queryId);
    expect(thread.map((m) => m.emailType)).toEqual([
      EMAIL_TYPE.INCOMING_QUERY,
      EMAIL_TYPE.ACKNOWLEDGEMENT,
      EMAIL_TYPE.FORWARD,
      EMAIL_TYPE.OUTGOING_RESPONSE,
    ]);

    const events = s().getAudit(queryId).map((a) => a.event);
    expect(events).toContain(AUDIT_EVENT.FINAL_APPROVAL_GRANTED);
    expect(events).toContain(AUDIT_EVENT.RESPONSE_DISPATCHED);
    expect(events).toContain(AUDIT_EVENT.QUERY_CLOSED);
    expect(events.indexOf(AUDIT_EVENT.FINAL_APPROVAL_GRANTED)).toBeLessThan(
      events.indexOf(AUDIT_EVENT.RESPONSE_DISPATCHED),
    );
  });

  it('never dispatches before final approval', async () => {
    const queryId = await readyForApproval();

    await expect(s().dispatchResponse(queryId, null, fakeResponse)).rejects.toThrow(
      /a response is sent only after final approval/,
    );
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(0);
  });

  it('still refuses a non-OIC approver, and a wrong role on retry', async () => {
    const queryId = await readyForApproval();

    await expect(s().grantFinalApproval(queryId, BHUMIKA, finalApproval())).rejects.toThrow(
      /may not perform FINAL_APPROVE/,
    );

    await s().grantFinalApproval(queryId, JATIN, finalApproval(failing)).catch(() => {});
    await expect(s().dispatchResponse(queryId, NEHA, fakeResponse)).rejects.toThrow(
      /may not perform DISPATCH/,
    );
  });
});

describe('assignment recommendation weighs expertise', () => {
  const officialFor = (subject, body) => {
    const { queryId } = s().ingestEmail(incomingEnquiry({ subject, body }));
    return s().recommendAssigneeFor(queryId);
  };

  it('recommends the microbiology official for a sterility enquiry', () => {
    const rec = officialFor(
      'Sterility testing requirements',
      'Please advise on endotoxin limits and bioburden testing.',
    );

    expect(findUserById(rec.userId).divisionId).toBe('DIV-007');
    expect(rec.reason).toMatch(/sterility|endotoxin|bioburden/i);
    expect(rec.factors.join(' ')).toContain('Expertise matched');
  });

  it('recommends the pharmacopoeial official for a monograph enquiry', () => {
    const rec = officialFor(
      'Monograph revision timelines',
      'Clarification on the applicable reference standard and specification.',
    );

    expect(findUserById(rec.userId).divisionId).toBe('DIV-006');
  });

  it('recommends the regulatory official for a submission enquiry', () => {
    const rec = officialFor(
      'Submission documentation requirements',
      'Which documentation and guideline applies for regulatory compliance?',
    );

    expect(findUserById(rec.userId).divisionId).toBe('DIV-009');
  });

  it('still returns somebody when nothing matches, and says so', () => {
    const rec = officialFor('Office parking', 'Where do visitors park?');

    expect(findUserById(rec.userId).role).toBe(ROLES.ASSIGNED_OFFICIAL);
    expect(rec.factors.join(' ')).toContain('No declared expertise matched');
    expect(rec.matchPercent).toBeGreaterThan(0);
  });

  it('remains advisory — the OIC assigns whoever they choose', async () => {
    const { queryId } = s().ingestEmail(incomingEnquiry({ subject: 'Sterility testing' }));
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const recommended = s().recommendAssigneeFor(queryId).userId;

    expect(s().getQuery(queryId).currentAssigneeId).toBeNull();

    const other = MOCK_USERS.find(
      (u) => u.role === ROLES.ASSIGNED_OFFICIAL && u.id !== recommended,
    );
    s().assignQuery(queryId, other.id, JATIN);

    expect(s().getQuery(queryId).currentAssigneeId).toBe(other.id);
    expect(s().getQuery(queryId).assignmentDecision.acceptedAiRecommendation).toBe(false);
  });
});

