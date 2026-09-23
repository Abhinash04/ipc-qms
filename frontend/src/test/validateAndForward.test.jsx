import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { EMAIL_TYPE } from '@/constants/emailModel';
import * as mailboxService from '@/services/api/mailboxService';
import { fakeAcceptEndpoint } from '@/test/fakeAcceptEndpoint';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');

const s = () => useWorkflowStore.getState();

/**
 * The two endpoints that send a case's email. Each takes a case and nothing
 * else — the recipient, the wording and whether it has already gone are the
 * server's to decide — so a test makes one fail by planning the outcome rather
 * than by handing back a reply. See src/test/fakeCaseMail.js.
 */
/** Re-install the endpoints, optionally with a planned failure for one. */
const installMail = (plan) => installFakeCaseMail(mailboxService, plan);

const enquiry = () => ({
  mailboxMessageId: 'MSG-VF-0001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Endotoxin limits clarification',
  body: 'Please clarify.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const received = () => s().ingestEmail(enquiry(), async () => null).queryId;

/**
 * A case as it exists after the Front Officer accepted the message in the
 * mailbox. That is the only way a case reaches the Front Office workspace now,
 * and accepting is one server call: register, acknowledge, forward. So an
 * accepted case normally arrives here already at PENDING_ASSIGNMENT.
 *
 * The options are the two steps that can fail on their own and leave work for
 * this page — `forwarded: false` holds the case at FRONT_OFFICE_VERIFICATION,
 * which is exactly the state the Forward button acts on.
 */
const accepted = async (outcome) => {
  const result = await s().acceptMailboxMessage(enquiry(), fakeAcceptEndpoint(outcome));
  return result.queryId;
};

const messagesOfType = (queryId, emailType) =>
  s().emailMessages.filter((m) => m.queryId === queryId && m.emailType === emailType);

function renderAt(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}


beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({});
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  installMail();

  await s().hydrate();
  await s().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('one action registers, acknowledges and forwards', () => {
  it('does all three from a single call', async () => {
    const queryId = received();

    const result = await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(result).toEqual({
      acknowledged: true,
      acknowledgementError: null,
      forwarded: true,
      forwardError: null,
    });
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(1);
    expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    expect(messagesOfType(queryId, EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
    expect(messagesOfType(queryId, EMAIL_TYPE.FORWARD)).toHaveLength(1);
  });

  it('leaves the OIC holding the query afterwards', async () => {
    const queryId = received();
    await s().validateAndForward(queryId, FRONT_OFFICE);

    // The workflow states themselves are untouched by this change.
    expect(s().getQuery(queryId).businessStatus).toBe('IN_PROGRESS');
    expect(
      s().notifications.some(
        (n) => n.queryId === queryId && n.recipientRole === 'OFFICER_IN_CHARGE',
      ),
    ).toBe(true);
  });

  it('refuses when the actor may not verify, without half-running', async () => {
    const queryId = received();

    await expect(s().validateAndForward(queryId, OIC)).rejects.toThrow(
      /may not perform VERIFY/,
    );
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.RECEIVED);
    expect(mailboxService.forwardQuery).not.toHaveBeenCalled();
  });
});

describe('the two emails are independent obligations', () => {
  it('still forwards when the acknowledgement fails', async () => {
    installMail({ acknowledgement: { outcome: 'FAILED', error: 'SMTP down' } });
    const queryId = received();

    const result = await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(false);
    expect(result.acknowledgementError).toMatch(/SMTP down/);
    // The important half: the query still reached the OIC.
    expect(result.forwarded).toBe(true);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('still acknowledges when the forward fails', async () => {
    installMail({ forward: { outcome: 'FAILED', error: 'Request failed 404' } });
    const queryId = received();

    const result = await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(true);
    expect(result.forwarded).toBe(false);
    expect(result.forwardError).toMatch(/404/);
    expect(messagesOfType(queryId, EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
  });

  it('holds the query at verification when the forward fails, so it can be retried', async () => {
    installMail({ forward: { outcome: 'FAILED', error: 'Request failed 404' } });
    const queryId = received();
    await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    );

    installMail();
    await s().forwardToOic(queryId, FRONT_OFFICE);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });
});

/**
 * What is left on the case page once validation moved into the mailbox.
 *
 * The page used to carry a "Validate Query" button that registered,
 * acknowledged and forwarded in one go. All three happen in the mailbox now, in
 * one server call. What remains here is recovery: the forward the accept could
 * not complete, and the acknowledgement it could not send — each read from the
 * case itself, so it survives the page being opened fresh long afterwards.
 */
describe('the case page forwards an already-accepted case', () => {
  it('offers no Validate step — that judgement was made in the mailbox', async () => {
    // The accept could not forward, so the forward is what this page is for.
    const queryId = await accepted({ forwarded: false });
    renderAt(`/front-officer/queries/${queryId}`);

    await screen.findByRole('heading', { name: 'Available actions' });
    expect(screen.queryByRole('button', { name: /Validate Query/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Forward to Officer-in-Charge/ }),
    ).toBeInTheDocument();
  });

  it('forwards on request and moves the case to pending assignment', async () => {
    const queryId = await accepted({ forwarded: false });
    // Accepting acknowledged the inquirer in the same request that created the
    // case. The browser sends no mail on that path at all, so the only email it
    // is about to send is the forward.
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();

    renderAt(`/front-officer/queries/${queryId}`);
    fireEvent.click(
      await screen.findByRole('button', { name: /Forward to Officer-in-Charge/ }),
    );

    await waitFor(() =>
      expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT),
    );
    expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Not forwarded to the Officer-in-Charge')).toBeNull();
  });

  it('warns that the Officer-in-Charge never received the case, and retries it', async () => {
    // The warning is derived from the case, not from a click on this page: a
    // case still at FRONT_OFFICE_VERIFICATION with no FORWARD message is one
    // the accept could not forward. So it is already on screen when the page
    // opens, long after the mailbox tab that failed has gone.
    const queryId = await accepted({ forwarded: false });
    installMail({ forward: { outcome: 'FAILED', error: 'Request failed 404' } });

    renderAt(`/front-officer/queries/${queryId}`);

    expect(
      await screen.findByText('Not forwarded to the Officer-in-Charge'),
    ).toBeInTheDocument();
    // The acknowledgement went out at accept time, so it is not also warned about.
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Retry forwarding/ }));
    await waitFor(() => expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1));
    // A retry that fails leaves the warning standing.
    expect(screen.getByText('Not forwarded to the Officer-in-Charge')).toBeInTheDocument();

    installMail();
    fireEvent.click(await screen.findByRole('button', { name: /Retry forwarding/ }));

    await waitFor(() =>
      expect(screen.queryByText('Not forwarded to the Officer-in-Charge')).toBeNull(),
    );
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('shows a registered case whose inquirer was never emailed, and retries it', async () => {
    // Whether the acknowledgement went out is read from the case, not
    // remembered from a click — so it survives the page being opened fresh,
    // long after the accept whose acknowledgement step failed.
    const queryId = await accepted({ acknowledged: false });

    renderAt(`/front-officer/queries/${queryId}`);

    expect(await screen.findByText('Acknowledgement email not sent')).toBeInTheDocument();
    // The case itself is fine — this is not a refusal — and the forward that
    // the same accept did complete is not warned about either.
    expect(screen.queryByText('Action refused')).toBeNull();
    expect(screen.queryByText('Not forwarded to the Officer-in-Charge')).toBeNull();
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);

    // Retrying the acknowledgement is still the browser's job; that path never
    // moved to the server.
    fireEvent.click(screen.getByRole('button', { name: /Retry sending/ }));

    await waitFor(() =>
      expect(screen.queryByText('Acknowledgement email not sent')).toBeNull(),
    );
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledWith({ queryId });
  });
});

describe('an enquiry that carries no thread id', () => {
  it('stores none on the case, and the forward still goes out', async () => {
    // A message the mailbox read without a thread id of its own. The id, when
    // there is one, belongs to the account the mail was read from; a foreign
    // one the Front Office cannot reply into is what made the forward 404.
    const { queryId } = s().ingestEmail({ ...enquiry(), providerThreadId: null }, async () => null);

    const incoming = messagesOfType(queryId, EMAIL_TYPE.INCOMING_QUERY)[0];
    expect(incoming.providerThreadId).toBeNull();

    /**
     * The request names the case and nothing else, so a thread id the browser
     * held can no longer reach the send at all. The server replies into the
     * thread it stored at intake — which for a portal enquiry is none.
     */
    await s().validateAndForward(queryId, FRONT_OFFICE);
    expect(mailboxService.forwardQuery).toHaveBeenCalledWith({ queryId });

    const forwarded = messagesOfType(queryId, EMAIL_TYPE.FORWARD)[0];
    expect(forwarded.providerThreadId).toBeNull();
  });
});
