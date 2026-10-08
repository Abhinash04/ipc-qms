import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NotificationBell } from '@/components/layout/NotificationBell';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const note = (id, at, message) => ({
  notificationId: id,
  queryId: 'QRY-2026-00001',
  recipientRole: FRONT_OFFICE.role,
  message,
  at,
});

beforeEach(async () => {
  await useWorkflowStore.getState().hydrate();
  await useWorkflowStore.getState().resetDemo();
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
});

describe('notification times', () => {
  it('shows how long ago each bell entry arrived, not always "Just now"', () => {
    useWorkflowStore.setState({
      notifications: [
        note('NOTIF-1', minutesAgo(5), 'Five minutes old'),
        note('NOTIF-2', minutesAgo(180), 'Three hours old'),
      ],
    });
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('prints the real date on the notifications page and never a made-up one', () => {
    useWorkflowStore.setState({
      notifications: [
        note('NOTIF-1', '2026-09-20T10:15:00.000Z', 'Dated'),
        note('NOTIF-2', 'not a date', 'Undated'),
      ],
    });
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/20 Sept? 2026/)).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
    expect(screen.queryByText(/19 Aug 2026/)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('renders recent notifications above older notifications in the bell dropdown', () => {
    useWorkflowStore.setState({
      notifications: [
        note('NOTIF-OLD', minutesAgo(2880), 'Two days old notification'),
        note('NOTIF-NEW', minutesAgo(26), '26 minutes ago notification'),
      ],
    });
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const notifItems = screen.getAllByRole('button').filter((el) => el.getAttribute('tabindex') === '0');
    expect(notifItems.length).toBe(2);
    expect(notifItems[0]).toHaveTextContent('26 minutes ago notification');
    expect(notifItems[1]).toHaveTextContent('Two days old notification');
  });
});

