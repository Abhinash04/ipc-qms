import axios from 'axios';
import { notify } from '@/services/notify';

export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
  withCredentials: true,
});

let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';

    if (status === 401 && !url.startsWith('/auth/') && onUnauthorized) {
      onUnauthorized();
    }

    if (!error?.response && error?.code !== 'ERR_CANCELED') {
      notify.error('Cannot reach the server', 'Check your connection — recent changes were not saved.', {
        id: 'network-unreachable',
      });
    }

    return Promise.reject(error);
  },
);
