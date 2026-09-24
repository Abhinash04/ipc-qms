import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { QueryDetailPage } from '@/pages/queries/QueryDetailPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import * as queryCaseService from '@/services/api/queryCaseService';
import { persistQueryTransition as writeOnServer } from '@/test/fakeQueryApi';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

vi.mock('@/services/api/queryCaseService', async () => {
  const fake = await import('@/test/fakeQueryApi');
  return { ...fake, fetchAllQueries: vi.fn(fake.fetchAllQueries) };
});

const s = () => useWorkflowStore.getState();
const FRONT_OFFICE = findUserById('USR-0002');

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const SUBJECT = 'Heavy metals limits in the revised monograph';

const REGENERATED = {
  text: 'A colleague regenerated this: the inquirer asks which heavy metals limits now apply.',
  keyPoints: ['Heavy metals limits'],
  topics: ['heavy metals'],
};

async function receivedCase() {
  const { queryId } = s().ingestEmail(
    {
      mailboxMessageId: 'MSG-CASE-0001',
      to: 'ipc-query-mock@example.com',
      from: `${INQUIRER.name} <${INQUIRER.email}>`,
      subject: SUBJECT,
      body: 'Which heavy metals limits apply now?',
      receivedAt: '2026-09-21T09:00:00.000Z',
    },
    async () => null,
  );
  await settled();
  return queryId;
}

function renderDetail(queryId) {
  return render(
    <MemoryRouter initialEntries={[`/queries/${queryId}`]}>
      <Routes>
        <Route path="/queries/:queryId" element={<QueryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useWorkflowStore.setState({ hydrated: false });
  await s().hydrate();
  await s().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
  vi.clearAllMocks();
});

describe('a case this tab has not loaded yet', () => {
  it('loads it from the server instead of saying it does not exist', async () => {
    const queryId = await receivedCase();
    useWorkflowStore.setState((state) => ({
      queries: state.queries.filter((q) => q.queryId !== queryId),
    }));

    renderDetail(queryId);

    expect(screen.getByText('Loading case…')).toBeInTheDocument();
    expect((await screen.findAllByText(SUBJECT)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Loading case…')).not.toBeInTheDocument();
    expect(screen.queryByText('Query not found')).not.toBeInTheDocument();
  });

  it('says it was not found after a single reload', async () => {
    renderDetail('QRY-2026-09999');

    expect(screen.getByText('Loading case…')).toBeInTheDocument();
    expect(await screen.findByText('Query not found')).toBeInTheDocument();
    expect(queryCaseService.fetchAllQueries).toHaveBeenCalledTimes(1);
  });
});

describe('the AI summary follows the store', () => {
  it('shows a summary a colleague regenerated once the store reloads', async () => {
    const queryId = await receivedCase();
    renderDetail(queryId);
    expect(screen.queryByText(REGENERATED.text)).not.toBeInTheDocument();

    await writeOnServer({ query: { ...s().getQuery(queryId), aiSummary: REGENERATED } });
    await act(() => s().refreshFromServer({ quiet: true }));

    expect(await screen.findByText(REGENERATED.text)).toBeInTheDocument();
  });
});
