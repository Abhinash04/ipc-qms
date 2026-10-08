import { axiosClient } from './axiosClient';

/** Every account (built-in and self-registered) with counts per status. Never includes passwords. */
export async function fetchAccounts() {
  const { data } = await axiosClient.get('/admin/users');
  return data;
}

const path = (userId) => `/admin/users/${encodeURIComponent(userId)}`;
const act = (userId, action, body = {}) =>
  axiosClient.post(`${path(userId)}/${action}`, body).then(({ data }) => data);

// `officer` carries { expertise, divisionId } when the role is Assigned Official.
export const approveAccount = (userId, role, officer = {}) => act(userId, 'approve', { role, ...officer });
export const rejectAccount = (userId, reason) => act(userId, 'reject', { reason: reason || null });
export const deactivateAccount = (userId) => act(userId, 'deactivate');
export const reactivateAccount = (userId) => act(userId, 'reactivate');
export const changeAccountRole = (userId, role, officer = {}) => act(userId, 'role', { role, ...officer });

/** Creates an approved account; the server decides which roles the caller may grant. */
export const createAccount = (account) => axiosClient.post('/admin/users', account).then(({ data }) => data);

/** Sends only the fields that changed. */
export const updateAccount = (userId, changes) => axiosClient.patch(path(userId), changes).then(({ data }) => data);

export const resetAccountPassword = (userId, password, confirmPassword) =>
  act(userId, 'password', { password, confirmPassword });
