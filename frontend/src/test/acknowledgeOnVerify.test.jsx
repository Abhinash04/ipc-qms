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

vi.mock('@/services/api/mailboxService');

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');

const s = () => useWorkflowStore.getState();

const ACK_RESULT = {
  from: 'Bhumika Makker <bhoomikamakker@gmail.com>',
  to: [INQUIRER.email],
  subject: 'Acknowledgement of Query Received',
  body: 'We have received your enquiry.',
  sentAt: '2026-08-26T10:00:00.000Z',
  providerMessageId: 'ack-msg-1',
};

const FORWARD_RESULT = {
  from: 'Bhumika Makker <bhoomikamakker@gmail.com>',
  to: ['rawatjatin436@gmail.com'],
  subject: 'Fwd: enquiry',
  body: 'forwarded',
  sentAt: '2026-08-26T10:05:00.000Z',
  providerMessageId: 'fwd-msg-1',
  providerThreadId: 'thread-1',
};

const enquiry = () => ({
  mailboxMessageId: 'MSG-ACK-0001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Sterility testing clarification',
  body: 'Please clarify the applicable limits.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

/** A freshly received query, sitting where Front Office would pick it up. */
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
  vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK_RESULT);
  vi.mocked(mailboxService.forwardQuery).mockResolvedValue(FORWARD_RESULT);

  await s().hydrate();
  await s().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
});

describe('Validate acknowledges the inquirer', () => {
  it('emails the inquirer as soon as the query is verified', async () => {
    const queryId = receivedQuery();

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(true);
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledWith({
      to: INQUIRER.email,
      queryId,
    });
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
    // Stand in for the ingestion chain, which acknowledges before verifying.
    s().recordAcknowledgement({ queryId, ...ACK_RESULT, timestamp: ACK_RESULT.sentAt });
    expect(ackMessages(queryId)).toHaveLength(1);

    const result = await s().verifyQuery(queryId, FRONT_OFFICE);

    expect(result).toEqual({ acknowledged: true, alreadySent: true });
    expect(mailboxService.sendAcknowledgement).not.toHaveBeenCalled();
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it('sends once even if acknowledgeInquirer is called again', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await s().acknowledgeInquirer(queryId, FRONT_OFFICE);

    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(1);
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
    // The point: the timeline moved anyway.
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

    vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK_RESULT);
    const retry = await s().acknowledgeInquirer(queryId, FRONT_OFFICE);

    expect(retry.acknowledged).toBe(true);
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it('keeps the permission gate throwing synchronously', () => {
    const queryId = receivedQuery();
    // The whole design rests on this: verifyQuery is not `async`, so an
    // unauthorised call throws rather than rejecting.
    expect(() => s().verifyQuery(queryId, findUserById('USR-0003'))).toThrow(
      /may not perform VERIFY/,
    );
  });
});

describe('the Front Office sees when the email did not go out', () => {
  const openCase = (queryId) => renderAt(`/front-officer/queries/${queryId}`);

  it('warns and offers a retry, without claiming the action failed', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(
      new Error('Network Error'),
    );
    const queryId = receivedQuery();
    openCase(queryId);

    fireEvent.click(await screen.findByRole('button', { name: /Validate Query/ }));

    expect(await screen.findByText('Acknowledgement email not sent')).toBeInTheDocument();
    // Not the red "Action refused" banner — the action itself did succeed.
    expect(screen.queryByText('Action refused')).toBeNull();
    // A failed acknowledgement does not stop the forward: the query still
    // reached the Officer-in-Charge.
    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.PENDING_ASSIGNMENT,
    );

    vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue(ACK_RESULT);
    fireEvent.click(screen.getByRole('button', { name: /Retry sending/ }));

    await waitFor(() =>
      expect(screen.queryByText('Acknowledgement email not sent')).toBeNull(),
    );
    expect(ackMessages(queryId)).toHaveLength(1);
  });

  it('shows no warning when the email goes out', async () => {
    const queryId = receivedQuery();
    openCase(queryId);

    fireEvent.click(await screen.findByRole('button', { name: /Validate Query/ }));

    await waitFor(() => expect(ackMessages(queryId)).toHaveLength(1));
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();
  });
});

describe('Forward to OIC still forwards the enquiry', () => {
  it('sends the forward and moves the query to pending assignment', async () => {
    const queryId = receivedQuery();
    await s().verifyQuery(queryId, FRONT_OFFICE);

    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1);
    expect(mailboxService.forwardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryId, subject: enquiry().subject }),
    );
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
    expect(
      s().emailMessages.some(
        (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
      ),
    ).toBe(true);
  });
});
