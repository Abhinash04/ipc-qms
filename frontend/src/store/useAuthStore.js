import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { findUserById } from '@/constants/mockUsers';

export const useAuthStore = create(
  persist(
    (set) => ({
      currentUser: null,
      login: (userId) => set({ currentUser: findUserById(userId) || null }),
      logout: () => set({ currentUser: null }),
    }),
    {
      name: 'qms.auth',
      partialize: (state) => ({ userId: state.currentUser?.id || null }),
      merge: (persisted, current) => ({
        ...current,
        currentUser: findUserById(persisted?.userId) || null,
      }),
    },
  ),
);
