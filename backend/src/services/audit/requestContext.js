import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who made the current HTTP request, and from where. Set for every request by
 * captureRequestContext, completed with the signed-in user by verifyToken, and
 * read by the audit service so each event records the user's name, IP address
 * and browser without every caller passing them.
 */
const storage = new AsyncLocalStorage();

const USER_AGENT_MAX = 300;

/** "::ffff:10.0.0.5" (an IPv4 address seen through IPv6) → "10.0.0.5". */
export const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '') || null;

export function captureRequestContext(req, res, next) {
  const context = {
    ip: cleanIp(req.ip || req.socket?.remoteAddress),
    userAgent: String(req.get?.('user-agent') || '').slice(0, USER_AGENT_MAX) || null,
    method: req.method,
    path: (req.originalUrl || req.url || '').split('?')[0],
    user: null,
  };
  storage.run(context, () => next());
}

/** Records the signed-in user on the current request's context. */
export function setContextUser(user) {
  const context = storage.getStore();
  if (context && user) {
    context.user = { id: user.id, name: user.name || null, role: user.role || null, sessionId: user.sessionId || null };
  }
}

export const currentContext = () => storage.getStore() || null;
