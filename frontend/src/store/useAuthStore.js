import { create } from 'zustand';
import * as authService from '@/services/api/authService';
import { setUnauthorizedHandler } from '@/services/api/axiosClient';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { notify } from '@/services/notify';

/**
 * The signed-in session.
 *
 * Deliberately NOT persisted. The session lives in an httpOnly cookie the
 * server sets; mirroring it into localStorage would be a copy that can drift
 * from the real thing and that any script on the page can read. On boot,
 * `hydrate()` asks the server who we are instead.
 *
 * `authReady` distinguishes "not signed in" from "we have not asked yet" —
 * without it, a page reload flashes the login screen before /auth/me answers.
 */
export const useAuthStore = create((set) => ({
  currentUser: null,
  authReady: false,

  /** Restores the session from the cookie. Called once at boot. */
  hydrate: async () => {
    try {
      const user = await authService.fetchMe();
      set({ currentUser: user, authReady: true });
    } catch {
      // Network failure, not a 401 (fetchMe maps that to null). Treat it as
      // signed out; the user can retry from the login screen.
      set({ currentUser: null, authReady: true });
    }
  },

  /** Throws on bad credentials so the login form can show the message. */
  login: async (email, password) => {
    const user = await authService.login(email, password);
    set({ currentUser: user, authReady: true });
    return user;
  },

  /** Development only: password-less sign-in as a seeded account. */
  devLogin: async (email) => {
    const user = await authService.devLogin(email);
    set({ currentUser: user, authReady: true });
    return user;
  },

  logout: async () => {
    // Caught, not just `finally`. The local state was always cleared, but the
    // rejection still escaped to the caller — and no caller awaits `logout()`,
    // so an offline sign-out surfaced as an unhandled rejection rather than as
    // nothing at all. Clearing locally is the whole contract here: the user
    // asked to leave, and the cookie expires on its own.
    try {
      await authService.logout();
    } catch {
      // Intentionally ignored — see above.
    }

    // The workflow store goes with the session: it holds case data loaded
    // under the outgoing account, and App.jsx reloads it for whoever signs in
    // next.
    set({ currentUser: null, authReady: true });
    useWorkflowStore.getState().resetHydration();
    notify.info('Signed out');
  },

  /** Invoked by the axios interceptor when the API says the session is gone. */
  clearSession: () => {
    set({ currentUser: null, authReady: true });
    useWorkflowStore.getState().resetHydration();
  },
}));

setUnauthorizedHandler(() => {
  // Only worth saying if we thought we were signed in. Without this the toast
  // would also fire for a stray 401 on a page nobody is authenticated on.
  const wasSignedIn = Boolean(useAuthStore.getState().currentUser);
  useAuthStore.getState().clearSession();
  if (wasSignedIn) {
    notify.warning('Your session has expired', 'Sign in again to continue.');
  }
});
