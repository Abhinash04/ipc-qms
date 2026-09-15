import { axiosClient } from './axiosClient';

/**
 * Session API.
 *
 * The token itself never passes through here — the server sets it as an
 * httpOnly cookie, so these calls only ever carry or receive the user record.
 */

export async function login(email, password) {
  const { data } = await axiosClient.post('/auth/login', { email, password });
  return data.user;
}

export async function logout() {
  await axiosClient.post('/auth/logout');
}

/**
 * The signed-in user, or `null` when there is no valid session.
 *
 * A 401 here is the normal answer for "not signed in", not an error worth
 * propagating — it is exactly what a first-time visitor gets.
 */
export async function fetchMe() {
  try {
    const { data } = await axiosClient.get('/auth/me');
    return data.user;
  } catch (error) {
    if (error?.response?.status === 401) return null;
    throw error;
  }
}
