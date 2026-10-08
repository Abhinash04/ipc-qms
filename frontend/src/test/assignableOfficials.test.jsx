import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppRoutes } from '@/routes/AppRoutes';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { AUDIT_EVENT } from '@/constants/statusEnums';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';
import { fakeCaseMail } from '@/test/fakeCaseMail';

// An officer who signed up with "Microbiology" and was approved: only the server knows them.
const NEW_OFFICER = {
  id: 'USR-7a1c09e2',
  name: 'Priya Menon',
  email: 'priya.menon@ipc.example',
  role: ROLES.ASSIGNED_OFFICIAL,
  divisionId: 'DIV-007',
  expertise: ['microbiology'],
};
const BUILT_IN_OFFICIALS = MOCK_USERS.filter((user) => user.role === ROLES.ASSIGNED_OFFICIAL);

vi.mock('@/services/api/aiService', () => ({
  fetchGemmaAiSummary: vi.fn(async () => null),
  fetchGemmaAiRecommendations: vi.fn(async () => null),
  fetchGemmaAiDraft: vi.fn(async () => null),
  fetchAssignableOfficials: vi.fn(async () => null),
}));

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
const OFFICIAL_A = findUserById('USR-0004');
const caseMail = fakeCaseMail();

const sterilityEnquiry = () => ({
  mailboxMessageId: 'MSG-EXP-00001',
  to: 'ipc-query-mock@example.com',
  from: 'Ravi Kumar <ravi.kumar@pharma.example>',
  subject: 'Sterility test acceptance criteria',
  body: 'Please clarify the endotoxin limits applicable to this injection.',
  receivedAt: '2026-10-01T09:00:00.000Z',
});

async function caseFromEnquiry() {
  const { queryId } = s().ingestEmail(sterilityEnquiry());
  s().verifyQuery(queryId, FRONT_OFFICE);
  await s().forwardToOic(queryId, FRONT_OFFICE, caseMail.forwardQuery);
  return queryId;
}

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
  const { fetchAssignableOfficials } = await import('@/services/api/aiService');
  vi.mocked(fetchAssignableOfficials).mockResolvedValue([...BUILT_IN_OFFICIALS, NEW_OFFICER]);
  await s().hydrate();
  await s().resetDemo();
});

describe('an officer approved after sign-up, in the assignment screens', () => {
  it('is recommended by the expertise chosen at sign-up', async () => {
    const queryId = await caseFromEnquiry();
    render(<AiRecommendationCard query={s().getQuery(queryId)} onAssign={null} />);

    expect(await screen.findByText(NEW_OFFICER.name)).toBeInTheDocument();
    expect(screen.queryByText(/No officer's expertise clearly matches/)).not.toBeInTheDocument();
  });

  it('is assigned from the card as the AI pick, recorded by name', async () => {
    const queryId = await caseFromEnquiry();
    const { fetchGemmaAiRecommendations } = await import('@/services/api/aiService');
    vi.mocked(fetchGemmaAiRecommendations).mockResolvedValueOnce([
      { rank: 1, userId: NEW_OFFICER.id, name: NEW_OFFICER.name, matchPercent: 82, reason: 'Microbiology.', expertise: NEW_OFFICER.expertise, matchedKeywords: ['sterility'], weakMatch: false },
      { rank: 2, userId: 'USR-0011', name: 'Arjun Nair', matchPercent: 82, reason: 'Sterility.', expertise: [], matchedKeywords: ['sterility'], weakMatch: false },
    ]);
    useAuthStore.setState({ currentUser: OIC });
    render(
      <AiRecommendationCard
        query={s().getQuery(queryId)}
        onAssign={(userId, ranking) => s().assignQuery(queryId, userId, OIC, ranking)}
      />,
    );

    const assign = await screen.findByRole('button', { name: 'Assign to Priya' });
    await act(async () => {
      fireEvent.click(assign);
    });

    const updated = s().getQuery(queryId);
    expect(updated.currentAssigneeId).toBe(NEW_OFFICER.id);
    expect(updated.assignmentDecision).toMatchObject({ assigneeId: NEW_OFFICER.id, acceptedAiRecommendation: true });
    const events = s().getAudit(queryId).map((entry) => entry.event);
    expect(events).not.toContain(AUDIT_EVENT.ASSIGNMENT_OVERRIDDEN);
    const assigned = s().getAudit(queryId).find((entry) => entry.event === AUDIT_EVENT.QUERY_ASSIGNED);
    expect(assigned.details).toContain(NEW_OFFICER.name);
  });

  it('warns when no officer’s expertise matches the query', async () => {
    const queryId = await caseFromEnquiry();
    const query = { ...s().getQuery(queryId), subject: 'Office furniture procurement', description: 'Chairs and desks.' };
    render(<AiRecommendationCard query={query} onAssign={null} />);

    expect(await screen.findByRole('status')).toHaveTextContent("No officer's expertise clearly matches this query");
  });

  it('can be handed a case through Transfer Query', async () => {
    const queryId = await caseFromEnquiry();
    s().assignQuery(queryId, OFFICIAL_A.id, OIC);
    const { unmount } = renderAs(OFFICIAL_A, `/assigned-official/queries/${queryId}`);

    fireEvent.click(screen.getByRole('button', { name: /Transfer Query/i }));
    const options = await screen.findAllByText(NEW_OFFICER.name);
    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole('button', { name: /Continue to Transfer/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Transfer/i }));

    await waitFor(() => expect(s().getQuery(queryId).currentAssigneeId).toBe(NEW_OFFICER.id));
    const transfer = s().getAudit(queryId).find((entry) => entry.event === AUDIT_EVENT.QUERY_TRANSFERRED);
    expect(transfer.details).toContain(`Transferred To: ${NEW_OFFICER.name}`);
    unmount();
  });

  it('falls back to the built-in officials when the server cannot list them', async () => {
    const { fetchAssignableOfficials } = await import('@/services/api/aiService');
    vi.mocked(fetchAssignableOfficials).mockResolvedValue(null);
    const queryId = await caseFromEnquiry();
    render(<AiRecommendationCard query={s().getQuery(queryId)} onAssign={null} />);

    expect(await screen.findByText('Arjun Nair')).toBeInTheDocument();
    expect(screen.queryByText(NEW_OFFICER.name)).not.toBeInTheDocument();
  });
});
