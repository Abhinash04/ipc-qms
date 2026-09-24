import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { QueryDetailPage } from '@/pages/queries/QueryDetailPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import * as queryCaseService from '@/services/api/queryCaseService';
import { EXTERNAL_INQUIRER as INQUIRER } from '@/test/externalInquirer';

vi.mock('@/services/api/mailboxService');

const captured = [];

vi.mock('@/services/api/queryCaseService', () => ({
  fetchAllQueries: vi.fn(async () => ({ queries: [] })),
  checkQueriesEmpty: vi.fn(async () => true),
  resetQueries: vi.fn(async () => ({ success: true })),
  grantFinalApproval: vi.fn(async () => ({ approved: true })),
  persistQueryTransition: vi.fn(async (delta) => {
    captured.push(delta);
    return { success: true };
  }),
}));

const REGENERATED = {
  text: 'The inquirer asks which dissolution limits apply after the 2022 revision.',
  keyPoints: ['Dissolution limits', '2022 monograph revision'],
  topics: ['dissolution'],
};

vi.mock('@/services/api/aiService', () => ({
  fetchGemmaAiSummary: vi.fn(async () => REGENERATED),
  fetchGemmaAiRecommendations: vi.fn(async () => null),
  fetchGemmaAiDraft: vi.fn(async () => null),
}));

const s = () => useWorkflowStore.getState();
const FRONT_OFFICE = findUserById('USR-0002');

const enquiry = () => ({
  mailboxMessageId: 'msg-summary-1',
  providerMessageId: 'msg-summary-1',
  providerThreadId: 'thread-summary-1',
  to: 'front-office@test.invalid',
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: 'Clarification on dissolution limits',
  body: 'Which limits apply to the revised monograph?',
  receivedAt: '2026-09-17T09:00:00.000Z',
  attachments: [],
});

function renderDetail(queryId) {
  useAuthStore.setState({ currentUser: FRONT_OFFICE });
  return render(
    <MemoryRouter initialEntries={[`/queries/${queryId}`]}>
      <Routes>
        <Route path="/queries/:queryId" element={<QueryDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let queryId;

beforeEach(async () => {
  captured.length = 0;
  vi.clearAllMocks();
  queryCaseService.persistQueryTransition.mockImplementation(async (delta) => {
    captured.push(delta);
    return { success: true };
  });
  useWorkflowStore.setState({ ...useWorkflowStore.getState(), hydrated: false });
  await s().hydrate();

  ({ queryId } = s().ingestEmail(enquiry(), async () => null));
  await new Promise((resolve) => setTimeout(resolve, 0));
  captured.length = 0;
});

describe('re-generating the AI summary from the case page', () => {
  it('persists the new summary under its own audit event', async () => {
    renderDetail(queryId);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Re-generate/ }));
    });

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const delta = captured.find(
      (d) => d.auditEvent?.event === AUDIT_EVENT.AI_SUMMARY_GENERATED,
    );
    expect(delta, 'no delta named AI_SUMMARY_GENERATED').toBeDefined();

    expect(delta.query.queryId).toBe(queryId);
    expect(delta.query.aiSummary.text).toBe(REGENERATED.text);
    expect(delta.auditEvent.details).toBe(REGENERATED.text);
    expect(delta.auditEvent.auditId).toEqual(expect.any(String));
  });

  it('keeps the event through JSON.stringify, which is where it used to vanish', async () => {
    renderDetail(queryId);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Re-generate/ }));
    });

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const onTheWire = JSON.parse(JSON.stringify(captured.at(-1)));
    expect(Object.keys(onTheWire.auditEvent)).toContain('event');
    expect(onTheWire.auditEvent.event).toBe(AUDIT_EVENT.AI_SUMMARY_GENERATED);
  });

  it('shows the re-generated summary and leaves it in the store', async () => {
    renderDetail(queryId);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Re-generate/ }));
    });

    expect(await screen.findAllByText(REGENERATED.text)).toHaveLength(2);
    expect(s().getQuery(queryId).aiSummary.text).toBe(REGENERATED.text);
  });
});
