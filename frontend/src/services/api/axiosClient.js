import axios from 'axios';

/**
 * Centralized Axios instance. Per engineering-rules.md, components must
 * never call axios directly — always go through a service in this folder,
 * wrapped by a React Query hook.
 */
export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
});
