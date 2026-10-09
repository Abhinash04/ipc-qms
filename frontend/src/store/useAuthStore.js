import { create } from 'zustand';
import * as authService from '@/services/api/authService';
import { setUnauthorizedHandler } from '@/services/api/axiosClient';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { notify } from '@/services/notify';
import { brandUser } from '@/constants/orgBranding';

export const useAuthStore = create((set) => ({
  currentUser: null,
  authReady: false,

  hydrate: async () => {
    try {
      const user = brandUser(await authService.fetchMe());
      set({ currentUser: user, authReady: true });
    } catch {
      set({ currentUser: null, authReady: true });
    }
  },

  login: async (email, password) => {
    const user = brandUser(await authService.login(email, password));
    set({ currentUser: user, authReady: true });
    return user;
  },

  googleLogin: async (credential) => {
    const user = brandUser(await authService.googleLogin(credential));
    set({ currentUser: user, authReady: true });
    return user;
  },

  devLogin: async (email) => {
    const user = brandUser(await authService.devLogin(email));
    set({ currentUser: user, authReady: true });
    return user;
  },

  logout: async () => {
    set({ currentUser: null, authReady: true });
    useWorkflowStore.getState().resetHydration();

    try {
      await authService.logout();
    } catch {}

    notify.info('Signed out');
  },

  clearSession: () => {
    set({ currentUser: null, authReady: true });
    useWorkflowStore.getState().resetHydration();
  },
}));

setUnauthorizedHandler(() => {
  const wasSignedIn = Boolean(useAuthStore.getState().currentUser);
  useAuthStore.getState().clearSession();
  if (wasSignedIn) {
    notify.warning('Your session has expired', 'Sign in again to continue.');
  }
});
