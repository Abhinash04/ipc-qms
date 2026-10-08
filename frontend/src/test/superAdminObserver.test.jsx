import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { MyWorkPage } from '@/pages/myWork/MyWorkPage';
import { ReviewsListPage } from '@/pages/reviews/ReviewsListPage';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { findUserById } from '@/constants/mockUsers';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { WORKFLOW_ACTION, canPerform, isCaseAssignee } from '@/constants/workflowRules';
import { ROLES } from '@/constants/roles';

const SUPER_ADMIN = findUserById('USR-0008');
const NEHA = findUserById('USR-0004');
const MEERA = findUserById('USR-0010');
const KAVITA = findUserById('USR-0006');

const caseFor = (n, assignee, workflowState, stepId = null) => ({
  queryId: `QRY-2026-0000${n}`,
  subject: `Case ${n}`,
  inquirer: { id: null, name: 'Ravi Kumar', email: 'ravi@pharma.example' },
  workflowState,
  businessStatus: 'IN_PROGRESS',
  priority: 'NORMAL',
  currentAssigneeId: assignee.id,
  currentWorkflowStepId: stepId,
  createdAt: '2026-10-01T09:00:00.000Z',
});

const QUERIES = [
  caseFor(1, NEHA, WORKFLOW_STATE.DRAFTING),
  caseFor(2, MEERA, WORKFLOW_STATE.UNDER_REVIEW, 'STEP-REVIEW-2'),
  caseFor(3, MEERA, WORKFLOW_STATE.ASSIGNED),
];

const STEPS = [
  { stepId: 'STEP-REVIEW-2', queryId: 'QRY-2026-00002', stepType: 'REVIEW', status: 'IN_PROGRESS', assignedUserId: KAVITA.id },
];

const AUDIT = [
  { auditId: 'A1', event: 'QUERY_ASSIGNED', queryId: 'QRY-2026-00001', actorId: 'USR-0003', actorRole: 'OFFICER_IN_CHARGE', at: '2026-10-02T09:00:00.000Z' },
  { auditId: 'A2', event: 'DRAFT_UPDATED', queryId: 'QRY-2026-00001', actorId: NEHA.id, actorRole: 'ASSIGNED_OFFICIAL', at: '2026-10-03T09:00:00.000Z' },
];

function Location() {
  const { search } = useLocation();
  return <output aria-label="location">{search}</output>;
}

function renderPage(user, Page, path = '/super-admin/my-work') {
  useAuthStore.setState({ currentUser: user, authReady: true });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<><Page /><Location /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const listed = () =>
  within(screen.getByRole('region', { name: /list$/ }))
    .queryAllByText(/^QRY-2026-/)
    .map((node) => node.textContent);

beforeEach(() => {
  useWorkflowStore.setState({
    queries: QUERIES,
    workflowSteps: STEPS,
    reviews: [],
    auditEvents: AUDIT,
    hydrated: true,
  });
});

describe('the Super Admin watches work without doing it', () => {
  it('holds no workflow action, on any case', () => {
    for (const action of Object.values(WORKFLOW_ACTION)) {
      for (const state of Object.values(WORKFLOW_STATE)) {
        expect(canPerform(ROLES.SUPER_ADMIN, action, state), `${action} @ ${state}`).toBe(false);
      }
    }
    expect(isCaseAssignee(SUPER_ADMIN, QUERIES[0])).toBe(false);
  });

  it('sees every case in progress on My Work, with who holds it and what they last did', () => {
    renderPage(SUPER_ADMIN, MyWorkPage);

    expect(listed()).toEqual(['QRY-2026-00001', 'QRY-2026-00002', 'QRY-2026-00003']);
    expect(screen.getByText('Held by')).toBeInTheDocument();
    expect(screen.getByText('Last activity')).toBeInTheDocument();

    const row = screen.getByText('QRY-2026-00001').closest('li');
    expect(within(row).getByText('Draft response updated')).toBeInTheDocument();
    expect(within(row).getByText(/Neha Singh ·/)).toBeInTheDocument();
    expect(within(screen.getByText('QRY-2026-00003').closest('li')).getByText('No activity yet')).toBeInTheDocument();
  });

  it("shows one user's queue exactly as they see it, and keeps the choice in the URL", () => {
    renderPage(SUPER_ADMIN, MyWorkPage);

    fireEvent.change(screen.getByLabelText('Viewing work of'), { target: { value: MEERA.id } });

    expect(listed()).toEqual(['QRY-2026-00002', 'QRY-2026-00003']);
    expect(screen.getByText('Queries assigned to or awaiting action from Meera Iyer.')).toBeInTheDocument();
    expect(screen.getByLabelText('location')).toHaveTextContent('?user=USR-0010');

    fireEvent.change(screen.getByLabelText('Viewing work of'), { target: { value: '' } });
    expect(listed()).toHaveLength(3);
  });

  it('opens straight onto a user named in the link', () => {
    renderPage(SUPER_ADMIN, MyWorkPage, `/super-admin/my-work?user=${NEHA.id}`);
    expect(listed()).toEqual(['QRY-2026-00001']);
  });

  it("shows a reviewer's review queue on Reviews", () => {
    renderPage(SUPER_ADMIN, ReviewsListPage, '/super-admin/reviews');
    expect(listed()).toEqual(['QRY-2026-00002']);

    fireEvent.change(screen.getByLabelText('Viewing work of'), { target: { value: 'USR-0005' } });
    expect(listed()).toEqual([]);

    fireEvent.change(screen.getByLabelText('Viewing work of'), { target: { value: KAVITA.id } });
    expect(listed()).toEqual(['QRY-2026-00002']);
  });

  it('gives everyone else neither the picker nor the audit column', () => {
    renderPage(NEHA, MyWorkPage, '/assigned-official/my-work?user=USR-0010');

    expect(listed()).toEqual(['QRY-2026-00001']);
    expect(screen.queryByLabelText('Viewing work of')).not.toBeInTheDocument();
    expect(screen.queryByText('Last activity')).not.toBeInTheDocument();
  });
});
