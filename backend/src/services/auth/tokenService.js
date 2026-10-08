import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import authConfig from '../../config/authConfig.js';

/** A new session's identifier, carried in the token and recorded on every audit event. */
export const newSessionId = () => `SES-${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * `registered` marks a self-registered account: it can be deactivated or have its role changed
 * at any time, so its sessions are re-checked against the database on every request
 * (see middleware/verifyToken).
 */
export function signToken(user, sessionId = newSessionId(), { registered = false } = {}) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email, sid: sessionId, ...(registered && { reg: true }) },
    authConfig.JWT_SECRET,
    { expiresIn: authConfig.SESSION_TTL_SECONDS },
  );
}

export function verifyToken(raw) {
  if (!raw) return null;
  try {
    const claims = jwt.verify(raw, authConfig.JWT_SECRET);
    if (!claims?.sub || !claims?.role) return null;
    return {
      id: claims.sub,
      role: claims.role,
      name: claims.name,
      email: claims.email,
      sessionId: claims.sid || null,
      registered: claims.reg === true,
      issuedAt: claims.iat ?? null,
    };
  } catch {
    return null;
  }
}
