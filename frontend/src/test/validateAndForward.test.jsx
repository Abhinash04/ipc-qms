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

vi.mock('@/services/api/mailboxService');

const INQUIRER = findUserById('USR-0001');
const FRONT_OFFICE = findUserById('USR-0002');
const OIC = findUserById('USR-0003');

const s = () => useWorkflowStore.getState();

const ACK_RESULT = {
  from: 'Bhumika Makker <bhoomikamakker@gmail.com>',
  to: [INQUIRER.email],
  subject: 'Acknowledgement of Query Received',
  body: 'Received.',
  sentAt: '2026-08-26T10:00:00.000Z',
  providerMessageId: 'ack-1',
};

const FORWARD_RESULT = {
  from: 'Bhumika Makker <bhoomikamakker@gmail.com>',
  to: ['rawatjatin436@gmail.com'],
  subject: 'Fwd: enquiry',
  body: 'forwarded',
  sentAt: '2026-08-26T10:05:00.000Z',
  providerMessageId: 'fwd-1',
  providerThreadId: 'thread-fo',
};

const enquiry = () => ({
  mailboxMessageId: 'MSG-VF-0001',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Endotoxin limits clarification',
  body: 'Please clarify.',
  receivedAt: '2026-08-26T09:00:00.000Z',
});

const received = () => s().ingestEmail(enquiry(), async () => null).queryId;

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

const validateButton = () => screen.findByRole('button', { name: /Validate Query/ });

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
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(new Error('SMTP down'));
    const queryId = received();

    const result = await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(false);
    expect(result.acknowledgementError).toMatch(/SMTP down/);
    // The important half: the query still reached the OIC.
    expect(result.forwarded).toBe(true);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('still acknowledges when the forward fails', async () => {
    vi.mocked(mailboxService.forwardQuery).mockRejectedValue(new Error('Request failed 404'));
    const queryId = received();

    const result = await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(result.acknowledged).toBe(true);
    expect(result.forwarded).toBe(false);
    expect(result.forwardError).toMatch(/404/);
    expect(messagesOfType(queryId, EMAIL_TYPE.ACKNOWLEDGEMENT)).toHaveLength(1);
  });

  it('holds the query at verification when the forward fails, so it can be retried', async () => {
    vi.mocked(mailboxService.forwardQuery).mockRejectedValueOnce(new Error('Request failed 404'));
    const queryId = received();
    await s().validateAndForward(queryId, FRONT_OFFICE);

    expect(s().getQuery(queryId).workflowState).toBe(
      WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
    );

    await s().forwardToOic(queryId, FRONT_OFFICE);
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });
});

describe('the Front Office needs only one click', () => {
  it('drives the whole chain from the Validate Query button', async () => {
    const queryId = received();
    renderAt(`/front-officer/queries/${queryId}`);

    fireEvent.click(await validateButton());

    await waitFor(() =>
      expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT),
    );
    expect(mailboxService.sendAcknowledgement).toHaveBeenCalledTimes(1);
    expect(mailboxService.forwardQuery).toHaveBeenCalledTimes(1);
    // Nothing failed, so no warnings and no leftover forward step.
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();
    expect(screen.queryByText('Not forwarded to the Officer-in-Charge')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Forward to Officer-in-Charge/ }),
    ).toBeNull();
  });

  it('warns and offers a retry when only the forward fails', async () => {
    vi.mocked(mailboxService.forwardQuery).mockRejectedValue(new Error('Request failed 404'));
    const queryId = received();
    renderAt(`/front-officer/queries/${queryId}`);

    fireEvent.click(await validateButton());

    expect(
      await screen.findByText('Not forwarded to the Officer-in-Charge'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Acknowledgement email not sent')).toBeNull();
    // The manual Forward button reappears as the recovery path.
    expect(
      screen.getByRole('button', { name: /Forward to Officer-in-Charge/ }),
    ).toBeInTheDocument();

    vi.mocked(mailboxService.forwardQuery).mockResolvedValue(FORWARD_RESULT);
    fireEvent.click(screen.getByRole('button', { name: /Retry forwarding/ }));

    await waitFor(() =>
      expect(screen.queryByText('Not forwarded to the Officer-in-Charge')).toBeNull(),
    );
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.PENDING_ASSIGNMENT);
  });

  it('reports both failures separately when neither email goes out', async () => {
    vi.mocked(mailboxService.sendAcknowledgement).mockRejectedValue(new Error('SMTP down'));
    vi.mocked(mailboxService.forwardQuery).mockRejectedValue(new Error('Request failed 404'));
    const queryId = received();
    renderAt(`/front-officer/queries/${queryId}`);

    fireEvent.click(await validateButton());

    expect(await screen.findByText('Acknowledgement email not sent')).toBeInTheDocument();
    expect(screen.getByText('Not forwarded to the Officer-in-Charge')).toBeInTheDocument();
    // Still not an "Action refused" — the query itself was registered.
    expect(screen.queryByText('Action refused')).toBeNull();
  });
});

describe('a portal enquiry carries no foreign thread id', () => {
  it('does not store the inquirers own Gmail thread on the case', async () => {
    const { queryId } = s().raiseEnquiry(
      {
        subject: 'Portal enquiry',
        body: 'Body',
        inquirer: { id: INQUIRER.id, name: INQUIRER.name, email: INQUIRER.email },
        providerMessageId: 'sent-by-inquirer',
        // ComposeEnquiryPage deliberately passes no providerThreadId: that id
        // belongs to the inquirer's mailbox and Front Office cannot reply into
        // it, which is what made the forward fail with a 404.
      },
      async () => null,
    );

    const incoming = messagesOfType(queryId, EMAIL_TYPE.INCOMING_QUERY)[0];
    expect(incoming.providerThreadId).toBeNull();

    await s().validateAndForward(queryId, FRONT_OFFICE);
    expect(mailboxService.forwardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ providerThreadId: null }),
    );
  });
});
