import jwt from 'jsonwebtoken';
import authConfig from '../../config/authConfig.js';

/**
 * Session tokens.
 *
 * Stateless JWT: there is no server-side session store, which keeps this
 * working in the DATABASE_URL-less configuration the rest of the backend
 * already supports. The trade-off is that a token cannot be revoked before it
 * expires — logout clears the cookie, but a copied token stays valid until
 * SESSION_TTL_SECONDS elapses.
 *
 * TODO(phase-2): add a revocation list once Mongo is a hard dependency.
 */

/** Claims carry only what authorization needs — never a password or hash. */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    authConfig.JWT_SECRET,
    { expiresIn: authConfig.SESSION_TTL_SECONDS },
  );
}

/** Returns the decoded principal, or null for any invalid/expired/forged token. */
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
    };
  } catch {
    // Expired, malformed, wrong signature — all indistinguishable to the caller
    // on purpose. The reason is not useful to a client and can aid an attacker.
    return null;
  }
}
