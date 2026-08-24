import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import * as mailboxService from '@/services/api/mailboxService';
import { findUserById, MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_DIRECTION, EMAIL_TYPE } from '@/constants/emailModel';

vi.mock('@/services/api/mailboxService');

const s = () => useWorkflowStore.getState();

const ABHINASH = findUserById('USR-0001');
const BHUMIKA = findUserById('USR-0002');
const JATIN = findUserById('USR-0003');
const NEHA = findUserById('USR-0004');
const RAWAT = findUserById('USR-0009');

function gmailEnquiry(overrides = {}) {
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

const fakeForward = (payload) =>
  Promise.resolve({
    from: `${BHUMIKA.name} <${BHUMIKA.email}>`,
    to: [JATIN.email],
    subject: `Fwd: ${payload.subject} [${payload.queryId}]`,
    body: payload.body,
    providerMessageId: 'gmail-forward-1',
    providerThreadId: payload.providerThreadId,
    sentAt: '2026-08-18T09:10:00.000Z',
  });

const fakeResponse = (payload) =>
  Promise.resolve({
    from: `${BHUMIKA.name} <${BHUMIKA.email}>`,
    to: [payload.to],
    subject: payload.subject,
    body: payload.body,
    providerMessageId: 'gmail-response-1',
    providerThreadId: '18f2a1b2c3d4e5f6',
    sentAt: '2026-08-18T12:00:00.000Z',
  });

const ACK = {
  from: `${BHUMIKA.name} <${BHUMIKA.email}>`,
  to: [ABHINASH.email],
  subject: 'Acknowledgement of Query Received – Indian Pharmacopoeia Commission [QRY-2026-00001]',
  body: 'Dear Sir/Madam,\n\nThis is to acknowledge that we have received your email/query.',
  providerMessageId: 'gmail-ack-1',
  sentAt: '2026-08-18T09:05:00.000Z',
};

function acknowledge(queryId) {
  return s().recordAcknowledgement({
    queryId,
    from: ACK.from,
    to: ACK.to,
    subject: ACK.subject,
    body: ACK.body,
    timestamp: ACK.sentAt,
    providerMessageId: ACK.providerMessageId,
  });
}

beforeEach(async () => {
  await s().hydrate();
  await s().resetDemo();
});

describe('the real identities', () => {
  it('holds Abhinash, Bhumika and Jatin as the first three stakeholders', () => {
    expect(ABHINASH).toMatchObject({ role: ROLES.INQUIRER, email: 'abhinash.pritiraj@gmail.com' });
    expect(BHUMIKA).toMatchObject({ role: ROLES.FRONT_OFFICE, email: 'bhoomikamakker@gmail.com' });
    expect(JATIN).toMatchObject({ role: ROLES.OFFICER_IN_CHARGE, email: 'rawatjatin436@gmail.com' });
  });

  it('holds Rawat Jatin as a MOCK Assigned Official — no Gmail account', () => {
    expect(RAWAT).toMatchObject({ id: 'USR-0009', role: ROLES.ASSIGNED_OFFICIAL });
    expect(RAWAT.email).toBe('rawat.jatin@ipc.example');
    expect(RAWAT.email).not.toMatch(/gmail/);
  });

  it('gives every Assigned Official expertise and no real identity', () => {
    const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

    expect(officials.length).toBeGreaterThanOrEqual(5);
    for (const official of officials) {
      expect(official.email, `${official.name} must stay mock`).toMatch(/@ipc\.example$/);
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

  it('leaves every user without a real identity on a mock address', () => {

    const realAddresses = new Set([ABHINASH.email, BHUMIKA.email, JATIN.email]);
    const stillMock = MOCK_USERS.filter((u) => !realAddresses.has(u.email));

    expect(stillMock.length).toBeGreaterThan(0);
    for (const user of stillMock) {
      expect(user.email, `${user.name} must stay mock`).toMatch(/@ipc\.example$/);
    }
  });

  it('offers the AI several officials to choose between', () => {
    const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);
    expect(officials.length).toBeGreaterThanOrEqual(5);

    expect(new Set(officials.map((u) => u.divisionId)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('1–3. Abhinash → Bhumika creates one stable Query Case', () => {
  it('creates the case from the incoming email, linked to the real Gmail ids', () => {
    const { queryId, threadId, created } = s().ingestEmail(gmailEnquiry());

    expect(created).toBe(true);
    expect(queryId).toBe('QRY-2026-00001');

    const query = s().getQuery(queryId);
    const message = s().emailMessages.find((m) => m.messageId === query.sourceEmailId);

    expect(query.threadId).toBe(threadId);
    expect(query.inquirer.email).toBe(ABHINASH.email);
    expect(query.inquirer.id).toBe(ABHINASH.id);
    expect(message.sourceMessageId).toBe('18f2a1b2c3d4e5f6');
    expect(message.providerThreadId).toBe('18f2a1b2c3d4e5f6');
    expect(message.direction).toBe(EMAIL_DIRECTION.INBOUND);
    expect(message.to).toEqual([BHUMIKA.email]);
  });

  it('keeps the same Query ID when the same mail is polled again', () => {
    const first = s().ingestEmail(gmailEnquiry());
    const second = s().ingestEmail(gmailEnquiry());
    const third = s().ingestEmail(gmailEnquiry());

    expect(second).toMatchObject({ queryId: first.queryId, created: false });
    expect(third.queryId).toBe(first.queryId);
    expect(s().queries).toHaveLength(1);
  });

  it('keeps the same Query ID across a reload', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());
    await new Promise((r) => setTimeout(r, 60));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], emailMessages: [], emailThreads: [], auditEvents: [],
      workflowSteps: [], reviews: [], responseVersions: [], notifications: [],
    });
    await s().hydrate();

    expect(s().queries.map((q) => q.queryId)).toEqual([queryId]);
    expect(s().ingestEmail(gmailEnquiry()).created).toBe(false);
    expect(s().queries).toHaveLength(1);
  });
});

describe('4. Bhumika acknowledges Abhinash on the same thread', () => {
  it('records the acknowledgement as sent by Bhumika, to Abhinash', () => {
    const { queryId, threadId } = s().ingestEmail(gmailEnquiry());
    const outcome = acknowledge(queryId);

    const ack = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT);

    expect(outcome.created).toBe(true);
    expect(ack.from).toContain(BHUMIKA.email);
    expect(ack.to).toEqual([ABHINASH.email]);
    expect(ack.direction).toBe(EMAIL_DIRECTION.OUTBOUND);
    expect(ack.threadId).toBe(threadId);
    expect(ack.queryId).toBe(queryId);
  });

  it('does not create another Query Case', () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());
    acknowledge(queryId);
    acknowledge(queryId);

    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
  });
});

describe('5–6. Bhumika forwards to Jatin, same case throughout', () => {
  it('sends the forward from Bhumika to Jatin on the same thread', async () => {
    const { queryId, threadId } = s().ingestEmail(gmailEnquiry());
    acknowledge(queryId);
    s().verifyQuery(queryId, BHUMIKA);

    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const forward = s().emailMessages.find((m) => m.emailType === EMAIL_TYPE.FORWARD);
    expect(forward.from).toContain(BHUMIKA.email);
    expect(forward.to).toEqual([JATIN.email]);
    expect(forward.threadId).toBe(threadId);
    expect(forward.subject).toContain(queryId);
    expect(forward.body).toContain('Original enquiry');
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('records who forwarded to whom in the audit trail', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    const entry = s()
      .getAudit(queryId)
      .find((a) => a.event === AUDIT_EVENT.QUERY_FORWARDED);

    expect(entry.actor).toBe(BHUMIKA.name);
    expect(entry.details).toContain(BHUMIKA.name);
    expect(entry.details).toContain(JATIN.email);
  });

  it('7. forwarding never creates a second Query Case', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    expect(s().queries.map((q) => q.queryId)).toEqual([queryId]);
  });

  it('7. a reply on the same Gmail thread attaches instead of creating QRY-2026-00002', () => {
    const { queryId, threadId } = s().ingestEmail(gmailEnquiry());

    const reply = s().ingestEmail(
      gmailEnquiry({
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
    const first = s().ingestEmail(gmailEnquiry());
    const other = s().ingestEmail(
      gmailEnquiry({
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
    const { queryId } = s().ingestEmail(gmailEnquiry());

    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);

    expect(() => s().assignQuery(queryId, NEHA.id, BHUMIKA)).toThrow(/may not perform ASSIGN/);
  });

  it('lets Jatin assign, but not verify or forward', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());

    expect(() => s().verifyQuery(queryId, JATIN)).toThrow(/may not perform VERIFY/);

    s().verifyQuery(queryId, BHUMIKA);
    await expect(s().forwardToOic(queryId, JATIN, fakeForward)).rejects.toThrow(
      /may not perform FORWARD/,
    );
  });

  it('refuses Abhinash any action on his own case', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());

    expect(() => s().verifyQuery(queryId, ABHINASH)).toThrow(/may not perform VERIFY/);
    await expect(s().forwardToOic(queryId, ABHINASH, fakeForward)).rejects.toThrow();
  });
});

describe('9–10. Jatin assigns a mock official and the mocked tail completes', () => {
  it('offers an advisory recommendation that Jatin is free to override', async () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());
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
    const { queryId } = s().ingestEmail(gmailEnquiry());
    acknowledge(queryId);

    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);
    s().assignQuery(queryId, NEHA.id, JATIN);

    s().generateAiDraft(queryId, NEHA);
    s().addReviewLevel(queryId, 'USR-0005', NEHA);
    s().addReviewLevel(queryId, 'USR-0006', NEHA);
    s().submitForReview(queryId, NEHA);
    s().approveReview(queryId, 'Reviewer I approves', findUserById('USR-0005'));
    s().approveReview(queryId, 'Reviewer II approves', findUserById('USR-0006'));

    await s().grantFinalApproval(queryId, JATIN, fakeResponse);

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
    const { queryId } = s().ingestEmail(gmailEnquiry());
    s().verifyQuery(queryId, BHUMIKA);

    const failing = () => Promise.reject(new Error('Gmail unavailable'));
    await expect(s().forwardToOic(queryId, BHUMIKA, failing)).rejects.toThrow(/Gmail unavailable/);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(0);
  });
});

describe('automatic intake — one email drives the whole Front Office stage', () => {

  function mockGmail({ forwardFails = false } = {}) {
    vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({
      messages: [gmailEnquiry()],
    });
    vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
    vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK);
    vi.mocked(mailboxService.forwardQuery).mockImplementation(
      forwardFails
        ? () => Promise.reject(new Error('Gmail unavailable'))
        : (payload) => fakeForward(payload),
    );
  }

  async function runIntake() {
    useAuthStore.setState({ currentUser: BHUMIKA });
    const { result } = renderHook(() => useMailboxIngestion());
    let outcome;
    await act(async () => {
      outcome = await result.current.ingestNow();
    });
    return outcome;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers, acknowledges, verifies and forwards from one email', async () => {
    mockGmail();
    const outcome = await runIntake();

    expect(outcome.created).toEqual(['QRY-2026-00001']);
    expect(outcome.acknowledged).toEqual(['QRY-2026-00001']);
    expect(outcome.forwarded).toEqual(['QRY-2026-00001']);

    const query = s().getQuery('QRY-2026-00001');
    expect(query.workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('writes the intake history in order, with Bhumika as the acting officer', async () => {
    mockGmail();
    await runIntake();

    const audit = s().getAudit('QRY-2026-00001');
    const events = audit.map((a) => a.event);

    expect(events).toEqual([
      AUDIT_EVENT.QUERY_RECEIVED,
      AUDIT_EVENT.AI_SUMMARY_GENERATED,
      AUDIT_EVENT.ACKNOWLEDGEMENT_SENT,
      AUDIT_EVENT.QUERY_REGISTERED,
      AUDIT_EVENT.QUERY_FORWARDED,
    ]);

    const verified = audit.find((a) => a.event === AUDIT_EVENT.QUERY_REGISTERED);
    const forwarded = audit.find((a) => a.event === AUDIT_EVENT.QUERY_FORWARDED);
    expect(verified.actor).toBe(BHUMIKA.name);
    expect(forwarded.actor).toBe(BHUMIKA.name);
    expect(forwarded.details).toContain(JATIN.email);
  });

  it('puts all three messages on one case and one thread', async () => {
    mockGmail();
    await runIntake();

    const query = s().getQuery('QRY-2026-00001');
    const thread = s().emailMessages.filter((m) => m.queryId === query.queryId);

    expect(thread.map((m) => m.emailType)).toEqual([
      EMAIL_TYPE.INCOMING_QUERY,
      EMAIL_TYPE.ACKNOWLEDGEMENT,
      EMAIL_TYPE.FORWARD,
    ]);
    expect(new Set(thread.map((m) => m.threadId))).toEqual(new Set([query.threadId]));

    expect(thread[0].to).toEqual([BHUMIKA.email]);
    expect(thread[1].to).toEqual([ABHINASH.email]);
    expect(thread[2].to).toEqual([JATIN.email]);
    expect(s().queries).toHaveLength(1);
  });

  it('keeps the case at verification when the forward email fails', async () => {
    mockGmail({ forwardFails: true });
    const outcome = await runIntake();

    expect(outcome.created).toEqual(['QRY-2026-00001']);
    expect(outcome.acknowledged).toEqual(['QRY-2026-00001']);
    expect(outcome.forwarded).toEqual([]);

    const query = s().getQuery('QRY-2026-00001');
    expect(query.workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(0);
  });

  it('re-polling the same enquiry changes nothing', async () => {
    mockGmail();
    await runIntake();
    const second = await runIntake();

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['QRY-2026-00001']);
    expect(s().queries).toHaveLength(1);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.FORWARD)).toHaveLength(1);
  });
});

describe('the inquirer device does not matter', () => {
  it('treats desktop and mobile as the same inquirer on the same thread', () => {
    const { queryId } = s().ingestEmail(gmailEnquiry());

    const fromPhone = s().ingestEmail(
      gmailEnquiry({
        mailboxMessageId: 'mobile-msg-1',
        providerMessageId: 'mobile-msg-1',
        body: 'Sent from my iPhone — one more detail.',
      }),
    );

    expect(fromPhone).toMatchObject({ queryId, created: false, reason: 'attached-to-thread' });
    expect(s().queries).toHaveLength(1);
  });

  it('opens a second case for a genuinely new enquiry from the same person', () => {
    const first = s().ingestEmail(gmailEnquiry());
    const second = s().ingestEmail(
      gmailEnquiry({
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
    const { queryId } = s().ingestEmail(gmailEnquiry());

    const query = s().getQuery(queryId);
    expect(query.inquirer.id).toBe(ABHINASH.id);
    expect(query.inquirer.email).toBe(ABHINASH.email);
  });
});

describe('final approval dispatches automatically', () => {

  async function readyForApproval() {
    const { queryId } = s().ingestEmail(gmailEnquiry());
    acknowledge(queryId);
    s().verifyQuery(queryId, BHUMIKA);
    await s().forwardToOic(queryId, BHUMIKA, fakeForward);
    s().assignQuery(queryId, NEHA.id, JATIN);
    s().generateAiDraft(queryId, NEHA);
    s().saveDraftVersion(queryId, 'The approved wording.', NEHA);
    s().addReviewLevel(queryId, 'USR-0005', NEHA);
    s().addReviewLevel(queryId, 'USR-0006', NEHA);
    s().submitForReview(queryId, NEHA);
    s().approveReview(queryId, 'Reviewer I approves', findUserById('USR-0005'));
    s().approveReview(queryId, 'Reviewer II approves', findUserById('USR-0006'));
    return queryId;
  }

  const failing = () => Promise.reject(new Error('Gmail unavailable'));

  it('1–2. approval alone takes the case from READY_FOR_DISPATCH to CLOSED', async () => {
    const queryId = await readyForApproval();

    await s().grantFinalApproval(queryId, JATIN, fakeResponse);

    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
  });

  it('3–5. sends from Bhumika to Abhinash on the existing case and thread', async () => {
    const queryId = await readyForApproval();
    const threadId = s().getQuery(queryId).threadId;

    await s().grantFinalApproval(queryId, JATIN, fakeResponse);

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

    await expect(s().grantFinalApproval(queryId, JATIN, failing)).rejects.toThrow(
      /Gmail unavailable/,
    );

    const query = s().getQuery(queryId);
    expect(query.workflowState).toBe(WORKFLOW_STATE.READY_FOR_DISPATCH);
    expect(query.workflowState).not.toBe(WORKFLOW_STATE.CLOSED);

    const approved = s().getVersions(queryId).find((v) => v.status === 'FINAL_APPROVED');
    expect(approved).toBeTruthy();
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(0);
  });

  it('8. a retry after a failure dispatches successfully', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, failing).catch(() => {});

    const outcome = await s().dispatchResponse(queryId, BHUMIKA, fakeResponse);

    expect(outcome.dispatched).toBe(true);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(1);
  });

  it('9. repeated triggers never send a second response', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, fakeResponse);

    const sendAgain = vi.fn(fakeResponse);
    const second = await s().dispatchResponse(queryId, null, sendAgain);
    const third = await s().dispatchResponse(queryId, null, sendAgain);

    expect(second).toMatchObject({ dispatched: false, reason: 'already-dispatched' });
    expect(third.reason).toBe('already-dispatched');
    expect(sendAgain).not.toHaveBeenCalled();
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(1);
  });

  it('9. survives a reload — the guard is persisted, not in memory', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, fakeResponse);
    await new Promise((r) => setTimeout(r, 60));

    useWorkflowStore.setState({
      hydrated: false,
      queries: [], emailMessages: [], emailThreads: [], auditEvents: [],
      workflowSteps: [], reviews: [], responseVersions: [], notifications: [],
    });
    await s().hydrate();

    const sendAgain = vi.fn(fakeResponse);
    const retry = await s().dispatchResponse(queryId, null, sendAgain);

    expect(retry.reason).toBe('already-dispatched');
    expect(sendAgain).not.toHaveBeenCalled();
  });

  it('10. the response appears in the thread and the audit trail', async () => {
    const queryId = await readyForApproval();
    await s().grantFinalApproval(queryId, JATIN, fakeResponse);

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
      /not READY_FOR_DISPATCH/,
    );
    expect(s().emailMessages.filter((m) => m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE)).toHaveLength(0);
  });

  it('still refuses a non-OIC approver, and a wrong role on retry', async () => {
    const queryId = await readyForApproval();

    await expect(s().grantFinalApproval(queryId, BHUMIKA, fakeResponse)).rejects.toThrow(
      /may not perform FINAL_APPROVE/,
    );

    await s().grantFinalApproval(queryId, JATIN, failing).catch(() => {});
    await expect(s().dispatchResponse(queryId, NEHA, fakeResponse)).rejects.toThrow(
      /may not perform DISPATCH/,
    );
  });
});

describe('assignment recommendation weighs expertise', () => {
  const officialFor = (subject, body) => {
    const { queryId } = s().ingestEmail(gmailEnquiry({ subject, body }));
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
    const { queryId } = s().ingestEmail(gmailEnquiry({ subject: 'Sterility testing' }));
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

