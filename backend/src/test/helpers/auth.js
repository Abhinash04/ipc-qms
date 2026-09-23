import authConfig from '../../config/authConfig.js';
import { signToken } from '../../services/auth/tokenService.js';
import { USERS } from '../../constants/users.js';
import { ROLES } from '../../constants/roles.js';

export function sessionCookie(role = ROLES.SUPER_ADMIN) {
  const user = USERS.find((entry) => entry.role === role);
  if (!user) throw new Error(`no seeded user holds the role "${role}"`);
  return `${authConfig.COOKIE_NAME}=${signToken(user)}`;
}

export function authHeader(role = ROLES.SUPER_ADMIN) {
  return { Cookie: sessionCookie(role) };
}

export const AUTH = authHeader(ROLES.SUPER_ADMIN);
