import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { EMAIL_TYPE } from '@/constants/emailModel';
import * as mailboxService from '@/services/api/mailboxService';
import * as queryCaseService from '@/services/api/queryCaseService';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { fakeFinalApprovalEndpoint } from '@/test/fakeFinalApprovalEndpoint';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

/**
 * One email per case, however many times it is asked for.
 *
 * A live test sent the same final response to one inquirer three times: the
 * first send hung for twenty-two seconds on a DNS failure, the officer pressed
 * Approve three more times, and every press was allowed through. The server is
 * the guard now — `backend/src/services/email/outbox.js`, pinned by
 * `backend/src/test/outbox.test.js` — and these are the client's share of it:
 * that a button cannot be pressed twice while it is working, that "already
 * sent" and "being sent" are reported as such rather than as failures, and that
 * a send nobody could confirm offers a way to record what happened instead of a
 * retry that could deliver a second copy.
 */

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');
const OFFICIAL = findUserById('USR-0004');
const REVIEWER = findUserById('USR-0005');

const s = () => useWorkflowStore.getState();

const enquiry = (id = 'MSG-IDEM-0001') => ({
  mailboxMessageId: id,
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Residual solvent limits',
  body: 'Please clarify the applicable limits.',
  receivedAt: '2026-09-01T09:00:00.000Z',
});

function renderAs(user, path) {
  useAuthStore.setState({ currentUser: user, authReady: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A case approved and locked, waiting only for the response to go out. */
async function readyForApproval(id) {
  const { queryId } = s().ingestEmail(enquiry(id), async () => null);
  await s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE);
  s().assignQuery(queryId, OFFICIAL.id, OIC);
  await s().generateAiDraft(queryId, OFFICIAL);
  s().addReviewLevel(queryId, REVIEWER.id, OFFICIAL);
  s().submitForReview(queryId, OFFICIAL);
  s().approveReview(queryId, 'Reads correctly.', REVIEWER);
  return queryId;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({});
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  installFakeCaseMail(mailboxService);

  await s().hydrate();
  await s().resetDemo();
});

describe('Approve cannot be pressed twice while it is working', () => {
  it('makes one request however many times it is clicked', async () => {
    const queryId = await readyForApproval();

    /**
     * A send that takes its time, which is the whole problem: the button stayed
     * enabled and inviting for as long as the request was open.
     */
    let release;
    const approve = vi.fn(async (...args) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return fakeFinalApprovalEndpoint({ actor: OIC.name })(...args);
    });
    vi.spyOn(queryCaseService, 'grantFinalApproval').mockImplementation(approve);

    renderAs(OIC, `/officer-in-charge/approvals/${queryId}`);
    const button = await screen.findByRole('button', { name: 'Approve' });

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approving and sending…' })).toBeDisabled(),
    );

    const busy = screen.getByRole('button', { name: 'Approving and sending…' });
    fireEvent.click(busy);
    fireEvent.click(busy);

    await act(async () => {
      release();
      await Promise.resolve();
    });

    await waitFor(() => expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(
      s().emailMessages.filter(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
      ),
    ).toHaveLength(1);
  });

  it('collapses concurrent approvals of the same case into one request', async () => {
    const queryId = await readyForApproval();
    const approve = vi.fn(fakeFinalApprovalEndpoint({ actor: OIC.name }));

    // Three tabs, or three impatient presses that raced past the button's own
    // guard. The store keeps one promise per case and hands it to all three.
    const [a, b, c] = await Promise.all([
      s().grantFinalApproval(queryId, OIC, approve),
      s().grantFinalApproval(queryId, OIC, approve),
      s().grantFinalApproval(queryId, OIC, approve),
    ]);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(
      s().emailMessages.filter(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
      ),
    ).toHaveLength(1);
  });
});

describe('what the Dispatch page does with a send that failed', () => {
  /** The case as final approval leaves it when the send did not go out. */
  const approvedButUnsent = async (id) => {
    const queryId = await readyForApproval(id);
    await s()
      .grantFinalApproval(
        queryId,
        OIC,
        fakeFinalApprovalEndpoint({
          actor: OIC.name,
          send: () => Promise.reject(new Error('getaddrinfo ENOTFOUND mail.mgovcloud.in')),
        }),
      )
      .catch(() => {});
    return queryId;
  };

  it('retries through the server and closes the case once it goes out', async () => {
    const queryId = await approvedButUnsent();
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.READY_FOR_DISPATCH);

    renderAs(FRONT_OFFICE, `/front-officer/dispatch/${queryId}`);
    fireEvent.click(await screen.findByRole('button', { name: /Retry sending/ }));

    await waitFor(() => expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED));
    expect(mailboxService.sendResponse).toHaveBeenCalledWith({ queryId });
    expect(
      s().emailMessages.filter(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
      ),
    ).toHaveLength(1);
  });

  it('reports "already sent" as a closed case, not as a failure', async () => {
    const queryId = await approvedButUnsent();

    /**
     * Two presses that raced: both passed the client's checks, because at the
     * moment each was made the case really was waiting to be dispatched. Only
     * the server can break the tie, and it does — the loser is told the email
     * has already gone rather than sending a second copy.
     */
    const [first, second] = await Promise.all([
      s().dispatchResponse(queryId, FRONT_OFFICE),
      s().dispatchResponse(queryId, FRONT_OFFICE),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(['ALREADY_SENT', 'SENT']);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED);
    expect(
      s().emailMessages.filter(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
      ),
    ).toHaveLength(1);
  });

  /**
   * The one case a retry must not be offered for. The mailbox was asked to
   * send and never said whether it had, so pressing "retry" can put a second
   * copy in the inquirer's inbox. What is offered instead is the pair of
   * answers a look in the Sent folder produces.
   */
  describe('a send nobody could confirm', () => {
    const unconfirmed = 'The mailbox did not confirm this send in time.';

    const uncertainCase = async (id) => {
      const queryId = await approvedButUnsent(id);
      installFakeCaseMail(mailboxService, {
        response: { outcome: 'UNCERTAIN', error: unconfirmed },
      });
      await s().dispatchResponse(queryId, FRONT_OFFICE).catch(() => {});
      return queryId;
    };

    it('offers what was found in the Sent folder instead of a retry', async () => {
      const queryId = await uncertainCase();

      renderAs(FRONT_OFFICE, `/front-officer/dispatch/${queryId}`);

      expect(
        await screen.findByText(/The response may already have been sent/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Retry sending/ })).toBeNull();
      expect(
        screen.getByRole('button', { name: /It was sent — record it and close the case/ }),
      ).toBeInTheDocument();
    });

    it('closes the case on "it was sent", without emailing anyone', async () => {
      const queryId = await uncertainCase();
      renderAs(FRONT_OFFICE, `/front-officer/dispatch/${queryId}`);

      vi.mocked(mailboxService.sendResponse).mockClear();
      fireEvent.click(
        await screen.findByRole('button', { name: /It was sent — record it and close the case/ }),
      );

      await waitFor(() => expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED));
      expect(mailboxService.sendResponse).not.toHaveBeenCalled();
      expect(
        s().emailMessages.filter(
          (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
        ),
      ).toHaveLength(1);
    });

    it('sends exactly once on "it was not sent"', async () => {
      const queryId = await uncertainCase();
      renderAs(FRONT_OFFICE, `/front-officer/dispatch/${queryId}`);
      await screen.findByRole('button', { name: /It was not sent/ });

      // The Sent folder was empty, so the send may happen — and does, once.
      installFakeCaseMail(mailboxService);
      vi.mocked(mailboxService.sendResponse).mockClear();
      fireEvent.click(screen.getByRole('button', { name: /It was not sent/ }));

      await waitFor(() => expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.CLOSED));
      expect(mailboxService.sendResponse).toHaveBeenCalledTimes(1);
      expect(
        s().emailMessages.filter(
          (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.OUTGOING_RESPONSE,
        ),
      ).toHaveLength(1);
    });
  });
});

describe('an acknowledgement nobody could confirm', () => {
  it('offers the same two answers on the case page, and records the one chosen', async () => {
    const { queryId } = s().ingestEmail(enquiry('MSG-IDEM-ACK'), async () => null);
    installFakeCaseMail(mailboxService, {
      acknowledgement: { outcome: 'UNCERTAIN', error: 'The mailbox did not confirm this send.' },
    });
    await s().verifyQuery(queryId, FRONT_OFFICE);

    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);

    expect(
      await screen.findByText('Acknowledgement may already have been sent'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'It was sent' }));

    await waitFor(() =>
      expect(
        s().emailMessages.filter(
          (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
        ),
      ).toHaveLength(1),
    );
    // Recording it is not sending it.
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(1);
  });
});
