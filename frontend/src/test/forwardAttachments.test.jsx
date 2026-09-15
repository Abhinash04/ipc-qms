import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const s = () => useWorkflowStore.getState();

const ATTACHMENTS = [{ attachmentId: 'att_1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 100 }];

const enquiry = (overrides = {}) => ({
  mailboxMessageId: 'MSG-FWD-ATT-1',
  to: 'ipc-query-mock@example.com',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Enquiry with an attachment',
  body: 'Please see attached.',
  attachments: ATTACHMENTS,
  receivedAt: '2026-08-26T09:00:00.000Z',
  ...overrides,
});

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

beforeEach(async () => {
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({});
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({ messages: [] });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({ ingested: true });
  vi.mocked(mailboxService.sendAcknowledgement).mockResolvedValue({});
  vi.mocked(mailboxService.sendResponse).mockResolvedValue({});

  await s().hydrate();
  await s().resetDemo();
});

describe('forwarding a query with attachments', () => {
  it('sends the query attachments in the forwardQuery payload', async () => {
    vi.mocked(mailboxService.forwardQuery).mockResolvedValue({
      from: 'fo@test.invalid',
      to: ['oic@test.invalid'],
      subject: 'Fwd',
      body: 'x',
      sentAt: '2026-08-26T10:00:00.000Z',
      providerMessageId: 'fwd-1',
      attachments: ATTACHMENTS,
    });

    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(mailboxService.forwardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: ATTACHMENTS }),
    );

    const forwardMessage = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
    );
    expect(forwardMessage.attachments).toEqual(ATTACHMENTS);
  });

  it('a forward with no attachments sends an empty array, unchanged behaviour', async () => {
    vi.mocked(mailboxService.forwardQuery).mockResolvedValue({
      from: 'fo@test.invalid',
      to: ['oic@test.invalid'],
      subject: 'Fwd',
      body: 'x',
      sentAt: '2026-08-26T10:00:00.000Z',
      providerMessageId: 'fwd-1',
    });

    const { queryId } = s().ingestEmail(enquiry({ mailboxMessageId: 'MSG-FWD-ATT-2', attachments: [] }), async () => null);
    s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(mailboxService.forwardQuery).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }));
  });

  it('a fail-closed rejection from the backend leaves the query un-forwarded and reports the missing file', async () => {
    vi.mocked(mailboxService.forwardQuery).mockRejectedValue(
      new Error('Missing attachment(s): spec.pdf'),
    );

    const { queryId } = s().ingestEmail(enquiry({ mailboxMessageId: 'MSG-FWD-ATT-3' }), async () => null);
    s().verifyQuery(queryId, FRONT_OFFICE);

    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);

    fireEvent.click(await screen.findByRole('button', { name: /Forward to Officer-in-Charge/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Missing attachment(s): spec.pdf');
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(
      s().emailMessages.some((m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD),
    ).toBe(false);
  });
});
