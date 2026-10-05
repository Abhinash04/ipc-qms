import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import authConfig from '../../config/authConfig.js';

/** A new session's identifier, carried in the token and recorded on every audit event. */
export const newSessionId = () => `SES-${randomBytes(4).toString('hex').toUpperCase()}`;

export function signToken(user, sessionId = newSessionId()) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email, sid: sessionId },
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
    };
  } catch {
    return null;
  }
}
