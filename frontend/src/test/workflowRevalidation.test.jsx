import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import { WorkflowRevalidation } from '@/components/workflow/WorkflowRevalidation';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { FRONT_OFFICE_USER as FRONT_OFFICE } from '@/test/frontOfficeUser';


let reload;

const focus = () => window.dispatchEvent(new Event('focus'));
const tabShown = () => document.dispatchEvent(new Event('visibilitychange'));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/one']}>
      <WorkflowRevalidation />
      <Routes>
        <Route path="/one" element={<Link to="/two">Next page</Link>} />
        <Route path="/two" element={<p>Second page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reload = vi.fn(async () => true);
  useWorkflowStore.setState({ hydrated: true, refreshedAt: 0, refreshFromServer: reload });
  useAuthStore.setState({ currentUser: FRONT_OFFICE, authReady: true });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the workflow store reloads when the user comes back to it', () => {
  it('leaves the first render alone', () => {
    renderShell();

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once, quietly, when the route changes', async () => {
    renderShell();

    fireEvent.click(screen.getByText('Next page'));
    await screen.findByText('Second page');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith({ quiet: true });
  });

  it('reloads when the tab becomes visible again', () => {
    renderShell();

    act(() => tabShown());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when window focus and a visible tab arrive together', () => {
    renderShell();

    act(() => {
      focus();
      tabShown();
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the first reload has settled', async () => {
    let settle;
    reload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    renderShell();

    act(() => focus());
    act(() => focus());
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => settle(true));
    act(() => focus());

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('ignores a tab that became hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderShell();

    act(() => tabShown());

    expect(reload).not.toHaveBeenCalled();
  });

  it('skips a reload within two seconds of the last one', () => {
    useWorkflowStore.setState({ refreshedAt: Date.now() });
    renderShell();

    act(() => focus());

    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing before the store is hydrated or once signed out', () => {
    useWorkflowStore.setState({ hydrated: false });
    renderShell();

    act(() => focus());
    useWorkflowStore.setState({ hydrated: true });
    useAuthStore.setState({ currentUser: null });
    act(() => focus());

    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing while the browser is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderShell();

    act(() => focus());

    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderShell();
    unmount();

    focus();
    tabShown();

    expect(reload).not.toHaveBeenCalled();
  });
});
