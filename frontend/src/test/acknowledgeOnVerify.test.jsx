import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { EMAIL_TYPE } from '@/constants/emailModel';
import * as mailboxService from '@/services/api/mailboxService';
import { notify } from '@/services/notify';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const FRONT_OFFICE = findUserById('USR-0002');

const s = () => useWorkflowStore.getState();

let caseMail;

const restoreMail = () => {
  vi.mocked(mailboxService.sendAcknowledgement).mockImplementation(caseMail.sendAcknowledgement);
};

const UNCONFIRMED_REASON =
  'NICeMail may have sent this message but did not confirm it in time. Check the NICeMail Sent folder before retrying.';

const unconfirmedFailure = () =>
  Object.assign(new Error('Request failed with status code 504'), {
    response: {
      status: 504,
      data: { error: UNCONFIRMED_REASON, unconfirmed: true },
    },
  });

const enquiry = () => ({
  mailboxMessageId: 'MSG-ACK-0001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Sterility testing clarification',
  body: 'Please clarify the applicable limits.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

function receivedQuery() {
  const { queryId } = s().ingestEmail(enquiry(), async () => null);
  return queryId;
}

const ackMessages = (queryId) =>
  s().emailMessages.filter(
    (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.ACKNOWLEDGEMENT,
  );

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
  caseMail = installFakeCaseMail(mailboxService);

  await s().hydrate();
  await s().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('Validate acknowledges the inquirer', () => {
  it('emails the inquirer as soon as the query is verified', async () => {
    const queryId = receivedQuery();

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(true);
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledWith({ queryId });
  });

  it('records the acknowledgement on the case, not just in the mail server', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(ackMessages(queryId)).toHaveLength(1);
    expect(
      s().auditEvents.some(
        (e) => e.queryId === queryId && e.event === AUDIT_EVENT.ACKNOWLEDGEMENT_SENT,
      ),
    ).toBe(true);
  });

  it('still advances the workflow exactly as before', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    );
  });
});

describe('the inquirer is never emailed twice', () => {
  it('does not re-send when the query is already acknowledged', async () => {
    const queryId = receivedQuery();
    await caseMail.sendAcknowledgement({ queryId });
    await s().refreshFromServer();
    expect(ackMessages(queryId)).toHaveLength(1);

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result).toMatchObject({ acknowledged: true, alreadySent: true });
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(1);
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it('sends once even if acknowledgeInquirer is called again', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);
    const second = await s().acknowledgeInquirer(queryId, FRONT_OFFICE);

    expect(second.alreadySent).toBe(true);
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(2);
    expect(ackMessages(queryId)).toHaveLength(1);
  });
});

describe('a failed acknowledgement never blocks the workflow', () => {
  it('verifies the query and reports the failure instead of throwing', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(
      new Error('Network Error'),
    );
    const queryId = receivedQuery();

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(false);
    expect(result.error).toMatch(/Network Error/);
    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    );
    expect(ackMessages(queryId)).toHaveLength(0);
  });

  it('can be retried successfully afterwards', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValueOnce(
      new Error('Network Error'),
    );
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    const retry = await s().acknowledgeInquirer(queryId, FRONT_OFFICE);

    expect(retry.acknowledged).toBe(true);
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it("reports the server's reason, and that the send may have gone out", async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(unconfirmedFailure());
    const queryId = receivedQuery();

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result).toMatchObject({ acknowledged: false, unconfirmed: true });
    expect(result.error).toMatch(/Sent folder/);
    expect(ackMessages(queryId)).toHaveLength(0);
  });

  it('keeps the permission gate throwing synchronously', () => {
    const queryId = receivedQuery();
    expect(() => s().verifyQuery(queryId, findUserById('USR-0003'))).toThrow(
      /may not perform VERIFY/,
    );
  });
});

describe('the Front Office sees when the email did not go out', () => {
  const openCase = (queryId) => renderAt(`/front-officer/queries/${queryId}`);

  it('warns and offers a retry, without claiming the case failed', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(
      new Error('Network Error'),
    );
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    openCase(queryId);

    expect(await screen.findByText('Acknowledgement email not sent')).toBeInTheDocument();
    expect(screen.queryByText('Action refused')).toBeNull();
    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    );

    restoreMail();
    fireEvent.click(screen.getByRole('button', { name: /Retry sending/ }));

    await waitFor(() =>
      expect(screen.queryByText('Acknowledgement email not sent')).toBeNull(),
    );
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it('says a retry may already have been sent, rather than that it was not', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(new Error('Network Error'));
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);
    openCase(queryId);
    await screen.findByText('Acknowledgement email not sent');

    const warning = vi.spyOn(notify, 'warning');
    installFakeCaseMail(mailboxService, {
      acknowledgement: { outcome: 'UNCERTAIN', error: UNCONFIRMED_REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry sending/ }));

    expect(await screen.findByText('Acknowledgement may already have been sent')).toBeInTheDocument();
    expect(screen.getByText(/Check the NICeMail Sent folder/)).toBeInTheDocument();
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();
    expect(warning).toHaveBeenCalledWith('Acknowledgement not confirmed', expect.stringMatching(/Sent folder/));
    warning.mockRestore();
  });

  it('shows no warning when the email goes out', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await waitFor(() => expect(ackMessages(queryId)).toHaveLength(1));

    openCase(queryId);

    await screen.findByRole('heading', { name: 'Available actions' });
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();
  });
});

describe('Forward to OIC still forwards the enquiry', () => {
  it('sends the forward and moves the query to pending assignment', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1);
    expect(mailboxService.forwardQuery).toHaveBeenCalledWith({ queryId });
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    expect(
      s().emailMessages.some(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
      ),
    ).toBe(true);
  });
});
