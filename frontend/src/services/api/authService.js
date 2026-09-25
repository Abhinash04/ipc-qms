import { axiosClient } from './axiosClient';

export async function login(email, password) {
  const { data } = await axiosClient.post('/auth/login', { email, password });
  return data.user;
}

export async function register(userData) {
  const { data } = await axiosClient.post('/auth/register', userData);
  return data;
}

export async function googleAuth(credential, department) {
  const { data } = await axiosClient.post('/auth/google', { credential, department });
  return data;
}

export async function devLogin(email) {
  const { data } = await axiosClient.post('/auth/dev-login', { email });
  return data.user;
}
export async function logout() {
  await axiosClient.post('/auth/logout');
}

export async function fetchMe() {
  try {
    const { data } = await axiosClient.get('/auth/me');
    return data.user;
  } catch (error) {
    if (error?.response?.status === 401) return null;
    throw error;
  }
}