import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/services/api/authService', () => ({
  login: vi.fn(),
  googleLogin: vi.fn(),
  devLogin: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  fetchMe: vi.fn(),
}));

import * as authService from '@/services/api/authService';
import { useAuthStore } from '@/store/useAuthStore';
import {
  IPC_FRONT_OFFICE_NAME,
  brandedFrom,
  brandedName,
  brandUser,
  greetingName,
} from '@/constants/orgBranding';
import { AuditHistoryCard } from '@/components/workflow/AuditHistoryCard';
import { DashboardHero } from '@/components/dashboard/DashboardHero';
import { buildCaseOfficials } from '@/constants/caseOfficials';
import { AUDIT_EVENT, WORKFLOW_STATE } from '@/constants/statusEnums';

const ADDRESS = 'contact.ecoclubs-edu@gov.in';
const ECO_USER = { id: 'USR-0014', name: 'Eco-Clubs Front Office', role: 'FRONT_OFFICE', email: ADDRESS };
const OFFICIAL = { id: 'USR-0004', name: 'Neha Singh', role: 'ASSIGNED_OFFICIAL', email: 'neha.singh@ipc.example' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUser: null, authReady: true });
});

describe('the Eco-Clubs account is presented as the IPC Front Office', () => {
  it.each(['Eco-Clubs Front Office', 'Eco Clubs', 'EcoClubs', 'eco-club front office'])(
    'renames "%s"',
    (name) => {
      expect(brandedName(name)).toBe(IPC_FRONT_OFFICE_NAME);
    },
  );

  it.each(['Neha Singh', 'IPC Lab Front Office', 'System', '', null, undefined])(
    'leaves "%s" alone',
    (name) => {
      expect(brandedName(name)).toBe(name);
    },
  );

  it('changes only the name on the user, never the email, id or role', () => {
    expect(brandUser(ECO_USER)).toEqual({ ...ECO_USER, name: IPC_FRONT_OFFICE_NAME });
    expect(brandUser(OFFICIAL)).toBe(OFFICIAL);
    expect(brandUser(null)).toBeNull();
  });

  it('rewrites the display name in a From header but keeps the address', () => {
    expect(brandedFrom(`Eco-Clubs Front Office <${ADDRESS}>`)).toBe(`${IPC_FRONT_OFFICE_NAME} <${ADDRESS}>`);
    expect(brandedFrom(`"Eco-Clubs Front Office" <${ADDRESS}>`)).toBe(`${IPC_FRONT_OFFICE_NAME} <${ADDRESS}>`);
    expect(brandedFrom(ADDRESS)).toBe(ADDRESS);
    expect(brandedFrom('ecoclubs.team@gov.in')).toBe('ecoclubs.team@gov.in');
    expect(brandedFrom('Neha Singh <neha.singh@ipc.example>')).toBe('Neha Singh <neha.singh@ipc.example>');
  });

  it('greets the IPC Front Office as "IPC" and everyone else by first name', () => {
    expect(greetingName(IPC_FRONT_OFFICE_NAME)).toBe('IPC');
    expect(greetingName('Eco-Clubs Front Office')).toBe('IPC');
    expect(greetingName('Neha Singh')).toBe('Neha');
    expect(greetingName('')).toBe('');
  });
});

describe('the signed-in session', () => {
  it('shows the IPC name after the Eco-Clubs account signs in, with its real email', async () => {
    vi.mocked(authService.login).mockResolvedValue(ECO_USER);

    const user = await useAuthStore.getState().login(ADDRESS, 'secret');

    expect(user.name).toBe(IPC_FRONT_OFFICE_NAME);
    expect(useAuthStore.getState().currentUser).toEqual({ ...ECO_USER, name: IPC_FRONT_OFFICE_NAME });
  });

  it('shows the IPC name when an existing session is restored', async () => {
    vi.mocked(authService.fetchMe).mockResolvedValue(ECO_USER);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().currentUser.name).toBe(IPC_FRONT_OFFICE_NAME);
  });

  it('does not touch any other account', async () => {
    vi.mocked(authService.login).mockResolvedValue(OFFICIAL);

    await useAuthStore.getState().login(OFFICIAL.email, 'secret');

    expect(useAuthStore.getState().currentUser).toBe(OFFICIAL);
  });
});

describe('records written under the old name', () => {
  it('shows the IPC name in the case audit history, as a person', () => {
    render(
      <AuditHistoryCard
        audit={[{ auditId: 'AUD-1', event: 'QUERY_FORWARDED', actor: 'Eco-Clubs Front Office', at: '2026-09-29T10:00:00.000Z' }]}
      />,
    );

    expect(screen.getByText(IPC_FRONT_OFFICE_NAME)).toBeInTheDocument();
    expect(screen.queryByText(/Eco-Clubs/)).toBeNull();
  });

  it('names the Front Office official as IPC but leaves the inquirer as written', () => {
    const officials = buildCaseOfficials({
      query: {
        queryId: 'QRY-2026-00001',
        workflowState: WORKFLOW_STATE.PENDING_ASSIGNMENT,
        inquirer: { name: 'Eco Club Volunteer', email: 'volunteer@example.org' },
      },
      audit: [{ event: AUDIT_EVENT.QUERY_FORWARDED, actor: 'Eco-Clubs Front Office' }],
    });

    expect(officials.find((row) => row.role === 'Front Office').name).toBe(IPC_FRONT_OFFICE_NAME);
    expect(officials.find((row) => row.role === 'Inquirer').name).toBe('Eco Club Volunteer');
  });

  it('greets the account as IPC on the dashboard', () => {
    render(<DashboardHero userName={IPC_FRONT_OFFICE_NAME} title="Dashboard" />);

    expect(screen.getByText(/, IPC$/)).toBeInTheDocument();
    expect(screen.queryByText(/, Indian$/)).toBeNull();
  });
});
