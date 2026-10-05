import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { RESPONSE_STATUS, WORKFLOW_STATE } from '@/constants/statusEnums';
import { fakeCaseMail } from '@/test/fakeCaseMail';

vi.mock('@/services/api/healthService', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
}));

vi.mock('@/services/api/mailboxService', () => ({
  rescueMailboxMessage: vi.fn().mockResolvedValue({ rescued: true }),
  fetchEmailConfig: vi.fn().mockResolvedValue({ transport: 'mock', ipcQueryEmail: 'ipc-query-mock@example.com' }),
  fetchMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
  fetchMailboxDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
  recordMailboxDecision: vi.fn().mockResolvedValue({ alreadyDecided: false }),
  markMessageIngested: vi.fn().mockResolvedValue({ ingested: true }),
  sendAcknowledgement: vi.fn().mockResolvedValue({ providerMessageId: 'mock-msg-2' }),
}));

const s = () => useWorkflowStore.getState();

const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');

const caseMail = fakeCaseMail();
const REQUEST = 'Please cite the relevant monograph.';
const NOTE = 'Monograph citation added to paragraph two.';

function renderAs(user, path) {
  useAuthStore.setState({ currentUser: user });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let queryId;

async function submittedForReview() {
  await s().hydrate();
  await s().resetDemo();
  ({ queryId } = s().ingestEmail({
    mailboxMessageId: 'MSG-RC-00001',
    to: 'ipc-query-mock@example.com',
    from: 'Inquirer <inquirer@pharma.example>',
    subject: 'Assay limits',
    body: 'What are the assay limits?',
    receivedAt: '2026-08-18T09:00:00.000Z',
  }));
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, caseMail.forwardQuery);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
}

function returnedAndRevised() {
  s().requestRevision(queryId, REQUEST, REVIEWER);
  const previous = s().getLatestVersion(queryId);
  s().saveDraftVersion(queryId, `${previous.content}\nSee the IP monograph on assay.`, OFFICIAL, 'Reviewer requested revision');
}

describe('requesting changes', () => {
  beforeEach(submittedForReview);

  it('marks the submitted version as submitted', () => {
    expect(s().getLatestVersion(queryId)).toMatchObject({ status: RESPONSE_STATUS.SUBMITTED, submittedBy: OFFICIAL.id });
  });

  it('shows only the two decisions in the card, each asking for its comment in a dialog', () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.queryByRole('textbox', { name: /Request changes|Changes required|Approval remarks/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled();
  });

  it('records the approval remarks a reviewer adds', async () => {
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const box = screen.getByRole('textbox', { name: 'Approval remarks (optional)' });
    expect(box).toHaveAttribute('placeholder', 'Reviewed and approved. The response is accurate and can proceed to the next stage.');

    fireEvent.change(box, { target: { value: '  Accurate and complete.  ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1));

    await waitFor(() =>
      expect(s().auditEvents.find((e) => e.queryId === queryId && e.event === 'REVIEW_COMPLETED')?.details).toBe(
        'Review approved: Accurate and complete.',
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('resubmitting after changes were requested', () => {
  beforeEach(submittedForReview);

  it('refuses a resubmission without a note on what changed', () => {
    returnedAndRevised();
    expect(() => s().submitForReview(queryId, OFFICIAL)).toThrow(/note describing the changes/);
  });

  it('refuses to resubmit the very version that was returned', () => {
    s().requestRevision(queryId, REQUEST, REVIEWER);
    expect(() => s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE })).toThrow(/save a new version/);
  });

  it('records who resubmitted which version, what changed and which request it answers', () => {
    returnedAndRevised();
    s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE });

    const request = s().getReviews(queryId).find((r) => r.decision === 'CHANGES_REQUESTED');
    expect(s().getLatestVersion(queryId)).toMatchObject({
      version: 'v2',
      status: RESPONSE_STATUS.SUBMITTED,
      submittedBy: OFFICIAL.id,
      changeSummary: NOTE,
      respondsToReviewId: request.reviewId,
    });
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.UNDER_REVIEW);
    expect(s().getAudit(queryId).some((e) => /v2 resubmitted for review .* on v1\. Changes implemented: Monograph/.test(e.details))).toBe(true);
  });

  it('asks the officer what changed before letting them resubmit', async () => {
    returnedAndRevised();
    renderAs(OFFICIAL, `/assigned-official/drafting/${queryId}`);

    const resubmit = screen.getByRole('button', { name: 'Resubmit for review' });
    expect(resubmit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Changes implemented/ }), { target: { value: NOTE } });
    expect(resubmit).toBeEnabled();

    fireEvent.click(resubmit);
    await waitFor(() => expect(s().getLatestVersion(queryId).changeSummary).toBe(NOTE));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Changes implemented/ })).toBeNull());
  });

  it('shows the next reviewer what was asked, what changed and which version they review', () => {
    returnedAndRevised();
    s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE });
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.getByText('Resubmitted after changes requested')).toBeInTheDocument();
    expect(screen.getByText('Round 2')).toBeInTheDocument();
    expect(screen.getByText(REQUEST)).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();

    const compare = screen.getByRole('button', { name: 'Compare v1 → v2' });
    expect(compare).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(compare);
    expect(screen.getByText('See the IP monograph on assay.').closest('[data-diff]')).toHaveAttribute('data-diff', 'added');
  });

  it('carries the same context to the Officer-in-Charge, who asks for changes in a dialog', () => {
    returnedAndRevised();
    s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE });
    s().approveReview(queryId, '', REVIEWER);
    renderAs(OIC, `/officer-in-charge/approvals/${queryId}`);

    expect(screen.getByText('Resubmitted after changes requested')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Return for revision' }));
    const dialog = screen.getByRole('dialog', { name: 'Return for revision' });
    const send = within(dialog).getByRole('button', { name: 'Return for revision' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Changes required' }), { target: { value: 'Tighten the wording.' } });
    expect(send).toBeEnabled();
  });
});

describe('an OIC rejection', () => {
  const REJECTION = 'The response does not adequately address the regulatory clarification requested by the stakeholder.';

  beforeEach(async () => {
    await submittedForReview();
    s().approveReview(queryId, '', REVIEWER);
  });

  const rejections = () => s().getReviews(queryId).filter((r) => r.decision === 'REJECTED');

  it('needs a reason', () => {
    expect(() => s().rejectFinalApproval(queryId, '  ', OIC)).toThrow(/requires a reason/);
    expect(rejections()).toEqual([]);
  });

  it('is recorded as its own review row with actor, role, version, stage and time', () => {
    s().rejectFinalApproval(queryId, REJECTION, OIC);

    expect(rejections()).toEqual([
      expect.objectContaining({
        decision: 'REJECTED',
        comment: REJECTION,
        reviewerId: OIC.id,
        reviewerRole: 'OFFICER_IN_CHARGE',
        version: 'v1',
        workflowState: WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
        stepId: null,
        at: expect.any(String),
      }),
    ]);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.RETURNED_FOR_REVISION);
    expect(s().getAudit(queryId).some((e) => e.details === `Final approval rejected on v1: ${REJECTION}`)).toBe(true);
  });

  it('stays distinct from a return for revision', () => {
    s().returnForRevisionFromApproval(queryId, 'Shorten it.', OIC);
    expect(s().getReviews(queryId).filter((r) => !r.stepId).map((r) => r.decision)).toEqual(['CHANGES_REQUESTED']);
  });

  it('is answered by the resubmission and kept, across several rounds', () => {
    s().rejectFinalApproval(queryId, REJECTION, OIC);
    s().saveDraftVersion(queryId, 'Revised once.', OFFICIAL, 'Reviewer requested revision');
    s().submitForReview(queryId, OFFICIAL, { changeSummary: 'Clarification added.' });
    s().approveReview(queryId, '', REVIEWER);
    s().returnForRevisionFromApproval(queryId, 'Shorten it.', OIC);
    s().saveDraftVersion(queryId, 'Revised twice.', OFFICIAL, 'Reviewer requested revision');
    s().submitForReview(queryId, OFFICIAL, { changeSummary: 'Shortened.' });

    const sentBack = s().getReviews(queryId).filter((r) => !r.stepId);
    expect(sentBack.map((r) => [r.decision, r.version, r.comment])).toEqual([
      ['REJECTED', 'v1', REJECTION],
      ['CHANGES_REQUESTED', 'v2', 'Shorten it.'],
    ]);
    expect(s().getVersions(queryId).map((v) => v.respondsToReviewId || null)).toEqual([null, sentBack[0].reviewId, sentBack[1].reviewId]);
  });

  it('asks the OIC for a reason and a confirmation before rejecting', async () => {
    renderAs(OIC, `/officer-in-charge/approvals/${queryId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(rejections()).toEqual([]);

    const dialog = screen.getByRole('dialog', { name: /^Reject v\d+\?$/ });
    expect(dialog).toHaveTextContent('The reason is recorded and sent back to the assigned official.');
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason for rejecting' }), { target: { value: REJECTION } });
    fireEvent.click(confirm);
    await waitFor(() => expect(rejections()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the officer the OIC reason, labelled as a rejection', () => {
    s().rejectFinalApproval(queryId, REJECTION, OIC);
    renderAs(OFFICIAL, `/assigned-official/drafting/${queryId}`);

    expect(screen.getByText('Rejected at final approval')).toBeInTheDocument();
    expect(screen.getByText(REJECTION)).toBeInTheDocument();
  });

  it('shows reviewers the earlier rejection once the officer resubmits', () => {
    s().rejectFinalApproval(queryId, REJECTION, OIC);
    s().saveDraftVersion(queryId, 'Revised.', OFFICIAL, 'Reviewer requested revision');
    s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE });
    renderAs(REVIEWER, `/reviewer/queries/${queryId}`);

    expect(screen.getByText('Resubmitted after rejection')).toBeInTheDocument();
    expect(screen.getByText('Rejection reason')).toBeInTheDocument();
    expect(screen.getByText(REJECTION)).toBeInTheDocument();
  });
});

describe('workflow progress tooltips', () => {
  beforeEach(submittedForReview);

  it('say who did what, when and on which version — the latest action per stage', async () => {
    s().requestRevision(queryId, REQUEST, REVIEWER);
    s().saveDraftVersion(queryId, 'Revised.', OFFICIAL, 'Reviewer requested revision');
    s().submitForReview(queryId, OFFICIAL, { changeSummary: NOTE });
    s().approveReview(queryId, '', REVIEWER);
    renderAs(OIC, `/officer-in-charge/queries/${queryId}`);

    const draftTrigger = document.querySelector('[data-stage-trigger="DRAFTED"]');
    fireEvent.focus(draftTrigger);
    const draftTip = await screen.findByRole('tooltip');
    expect(draftTip).toHaveTextContent(`${OFFICIAL.name} — Assigned Official`);
    expect(draftTip).toHaveTextContent('Resubmitted v2 for review after it was sent back');
    expect(draftTip).toHaveTextContent('Version:v2');
    expect(draftTip).toHaveTextContent(/Date:\d{2} [A-Z][a-z]{2} \d{4}/);
    expect(draftTip).toHaveTextContent(/Time:\d{2}:\d{2} (AM|PM)/);
    fireEvent.blur(draftTrigger);

    const reviewTrigger = document.querySelector('[data-stage-trigger^="REVIEW-"]');
    fireEvent.focus(reviewTrigger);
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Approved v2 and forwarded it to the Officer-in-Charge'),
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent(`${REVIEWER.name} — Reviewer I`);
  });
});
