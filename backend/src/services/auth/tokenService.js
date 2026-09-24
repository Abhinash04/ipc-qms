import jwt from 'jsonwebtoken';
import authConfig from '../../config/authConfig.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
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
    };
  } catch {
    return null;
  }
}
