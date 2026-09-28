import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { NicemailLoginReminder } from '@/components/workflow/NicemailLoginReminder';
import { useAuthStore } from '@/store/useAuthStore';
import { findUserById } from '@/constants/mockUsers';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';

vi.unmock('@/components/workflow/NicemailLoginReminder');

const OIC = findUserById('USR-0003');

beforeEach(() => {
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
});

describe('NICeMail login reminder', () => {
  it('greets the Front Office with the NICeMail login reminder', () => {
    render(<NicemailLoginReminder />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('NICeMail Login Required')).toBeTruthy();
    expect(
      screen.getByText(/enable the Browser Agent to access and synchronize your mailbox/),
    ).toBeTruthy();
  });

  it('opens the NICeMail sign-in page in a new tab', () => {
    render(<NicemailLoginReminder />);

    const link = screen.getByRole('link', { name: 'Login to NICeMail' });
    expect(link.getAttribute('href')).toBe(
      'https://accounts.mgovcloud.in/signin?servicename=VirtualOffice&serviceurl=https%3A%2F%2Fworkplace.mgovcloud.in%2F',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('dismisses when Close is clicked', () => {
    render(<NicemailLoginReminder />);

    fireEvent.click(screen.getByText('Close', { selector: 'button' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays hidden for other roles', () => {
    useAuthStore.setState({ currentUser: OIC, authReady: true });
    render(<NicemailLoginReminder />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
