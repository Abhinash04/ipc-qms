import { create } from 'zustand';
import { findUserById } from '@/constants/mockUsers';

/**
 * Mock authentication store. Seeded with Neha Singh (Assigned Official) as
 * the logged-in user for this prototype phase — there is no real login flow
 * yet. login()/logout() are stubs for the future auth integration.
 */
export const useAuthStore = create((set) => ({
  currentUser: findUserById('USR-0004'),
  login: (userId) => set({ currentUser: findUserById(userId) }),
  logout: () => set({ currentUser: null }),
}));
