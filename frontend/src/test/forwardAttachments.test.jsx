import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { EMAIL_TYPE } from '@/constants/emailModel';
import * as mailboxService from '@/services/api/mailboxService';
import { installFakeCaseMail } from '@/test/fakeCaseMail';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');


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
  installFakeCaseMail(mailboxService);

  await s().hydrate();
  await s().resetDemo();
});

describe('forwarding a query with attachments', () => {
  it('forwards the files the enquiry arrived with, named only by case', async () => {
    const { queryId } = s().ingestEmail(enquiry(), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE);

    expect(mailboxService.forwardQuery).toHaveBeenCalledWith({ queryId });

    const forwardMessage = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
    );
    expect(forwardMessage.attachments).toEqual(ATTACHMENTS);
  });

  it('records no attachments for an enquiry that carried none', async () => {
    const { queryId } = s().ingestEmail(enquiry({ mailboxMessageId: 'MSG-FWD-ATT-2', attachments: [] }), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);
    await s().forwardToOic(queryId, FRONT_OFFICE);

    const forwardMessage = s().emailMessages.find(
      (m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD,
    );
    expect(forwardMessage.attachments).toEqual([]);
  });

  it('a fail-closed rejection from the backend leaves the query un-forwarded and reports the missing file', async () => {
    installFakeCaseMail(mailboxService, {
      forward: { outcome: 'FAILED', error: 'Missing attachment(s): spec.pdf' },
    });

    const { queryId } = s().ingestEmail(enquiry({ mailboxMessageId: 'MSG-FWD-ATT-3' }), async () => null);
    await s().verifyQuery(queryId, FRONT_OFFICE);

    renderAs(FRONT_OFFICE, `/front-officer/queries/${queryId}`);

    fireEvent.click(await screen.findByRole('button', { name: /Forward to Officer-in-Charge/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Missing attachment(s): spec.pdf'));
    expect(s().getQuery(queryId).workflowState).toBe(WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION);
    expect(
      s().emailMessages.some((m) => m.queryId === queryId && m.emailType === EMAIL_TYPE.FORWARD),
    ).toBe(false);
  });
});
