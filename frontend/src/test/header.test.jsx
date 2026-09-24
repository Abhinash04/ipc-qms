import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES, ROLE_LABELS } from '@/constants/roles';

const userFor = (role) => MOCK_USERS.find((user) => user.role === role);

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await useWorkflowStore.getState().hydrate();
  useAuthStore.setState({ currentUser: userFor(ROLES.REVIEWER) });
});

describe('the header shows who is signed in', () => {
  it('names the current user', () => {
    const user = userFor(ROLES.REVIEWER);
    renderHeader();

    expect(screen.getByText(user.name)).toBeInTheDocument();
  });

  it('shows their role alongside the name', () => {
    const user = userFor(ROLES.REVIEWER);
    renderHeader();

    expect(
      screen.getByText(`— ${ROLE_LABELS[user.role]}`, { exact: false }),
    ).toBeInTheDocument();
  });

  it('follows a change of user', () => {
    const admin = userFor(ROLES.ADMIN);
    useAuthStore.setState({ currentUser: admin });
    renderHeader();

    expect(screen.getByText(admin.name)).toBeInTheDocument();
  });
});

describe('notifications live in the header, not the sidebar', () => {
  it('gives the bell an accessible name carrying the unread count', () => {
    renderHeader();

    expect(
      screen.getByRole('button', { name: /^Notifications \(\d+ unread\)$/ }),
    ).toBeInTheDocument();
  });
});
