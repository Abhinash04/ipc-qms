import axios from 'axios';

export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
  // The API authenticates with an httpOnly session cookie, which the browser
  // will not attach to a cross-origin request (5173 → 5000) unless this is
  // set. The server sends the matching `Access-Control-Allow-Credentials` —
  // see the cors() options in backend/src/app.js.
  withCredentials: true,
});

/**
 * Called when the API reports the session is gone.
 *
 * Registered by the auth store rather than imported from it: the store already
 * imports this module (via authService), so importing the store here would
 * close the cycle.
 */
let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';

    // A 401 from /auth/* is not an expired session: it is login failing, or
    // /auth/me answering "nobody is signed in" during boot. Both are handled
    // by their callers, and clearing state here would fight them.
    if (status === 401 && !url.startsWith('/auth/') && onUnauthorized) {
      onUnauthorized();
    }

    // Deliberately silent — no console.warn/error. The frontend test setup
    // fails any test that writes to either channel.
    return Promise.reject(error);
  },
);
