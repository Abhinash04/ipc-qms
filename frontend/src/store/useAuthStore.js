import { create } from 'zustand';
import { findUserById } from '@/constants/mockUsers';

export const useAuthStore = create((set) => ({
  currentUser: findUserById('USR-0004'),
  login: (userId) => set({ currentUser: findUserById(userId) }),
  logout: () => set({ currentUser: null }),
}));
