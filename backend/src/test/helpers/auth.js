import authConfig from '../../config/authConfig.js';
import { signToken } from '../../services/auth/tokenService.js';
import { USERS } from '../../constants/users.js';
import { ROLES } from '../../constants/roles.js';

/**
 * Session cookies for the suite.
 *
 * Lives under `helpers/` rather than beside the tests because
 * `vitest.config.mjs` collects `src/**\/*.test.js` — a file named `auth.js`
 * is never mistaken for a test.
 *
 * Mints the cookie directly rather than calling POST /auth/login, so a test
 * about forwarding email does not also depend on the login endpoint working.
 */

export function sessionCookie(role = ROLES.SUPER_ADMIN) {
  const user = USERS.find((entry) => entry.role === role);
  if (!user) throw new Error(`no seeded user holds the role "${role}"`);
  return `${authConfig.COOKIE_NAME}=${signToken(user)}`;
}

export function authHeader(role = ROLES.SUPER_ADMIN) {
  return { Cookie: sessionCookie(role) };
}

/**
 * The default header for suites that predate authentication.
 *
 * SUPER_ADMIN deliberately: those tests assert email, attachment and AI
 * behaviour, not authorization, so they should carry the credential least
 * likely to make them fail for a reason they are not about. It satisfies every
 * `verifyRole` list and every `verifyAction` in ROLE_ACTIONS. Role and action
 * boundaries are tested on purpose in rbac.test.js, via `authHeader(role)`.
 */
export const AUTH = authHeader(ROLES.SUPER_ADMIN);
