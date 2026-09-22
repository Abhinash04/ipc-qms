import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';
import authConfig, { cookieOptions } from '../config/authConfig.js';
import { signToken } from '../services/auth/tokenService.js';
import {
  verifyCredentials,
  findByEmail,
  findById,
  listUsers,
  toPublicUser,
} from '../services/auth/userDirectory.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { nicFrontOfficeUser } from '../constants/users.js';

/**
 * Session endpoints — step 1 of the chain in .claude/backend-rules.md.
 *
 * The token is delivered as an httpOnly cookie rather than in the response
 * body, so no script can read it and the browser attaches it automatically to
 * `<img src>`, `<iframe src>` and `<a download>` requests — which is what makes
 * attachment preview and download work at all, since those cannot carry an
 * Authorization header.
 */

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      throw Object.assign(new Error('"email" and "password" are required'), {
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    const user = await verifyCredentials(email, password);

    if (!user) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        result: AUDIT_RESULTS.DENIED,
        actorType: ACTOR_TYPES.HUMAN,
        // The address attempted, not a resolved user — on a failed login there
        // may be no user, and which address was tried is the point.
        details: { email: String(email).trim().toLowerCase() },
      });

      // One message for an unknown address and a wrong password alike —
      // distinguishing them enumerates valid accounts. userDirectory runs the
      // bcrypt compare either way so the timing matches too.
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Invalid email or password' });
    }

    await audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: user.id,
      actorRole: user.role,
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(user), cookieOptions());
    return res.status(HTTP_STATUS.OK).json({ user });
  } catch (error) {
    return next(error);
  }
}

/**
 * Clearing the cookie is the whole of logout: tokens are stateless, so a copy
 * taken before this call stays valid until it expires — see tokenService.js.
 */
function logout(req, res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(authConfig.COOKIE_NAME, options);
  return res.status(HTTP_STATUS.OK).json({ ok: true });
}

/** Who the caller is. Requires verifyToken. */
function me(req, res) {
  // The claims are enough to answer, but reading the directory means a user
  // removed since the token was signed no longer resolves.
  const user = findById(req.user.id);

  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Authentication required' });
  }

  return res.status(HTTP_STATUS.OK).json({ user: toPublicUser(user) });
}

/**
 * The staff directory, for a signed-in caller.
 *
 * The client used to carry this list itself, in
 * frontend/src/constants/mockUsers.js, complete with every account's login
 * address — and because the login page imports that module, the whole directory
 * shipped in the entry chunk that an UNAUTHENTICATED visitor downloads. That is
 * a list of valid usernames and their privilege levels, handed out before
 * anyone signs in.
 *
 * Serving it from here instead means it costs a session. `toPublicUser` already
 * projects away everything that is not id/name/email/role/divisionId, and there
 * is no credential on a user record to project away in the first place.
 */
function users(req, res) {
  return res.status(HTTP_STATUS.OK).json({ users: listUsers() });
}

/**
 * Development-only: sign in as any seeded user without a password.
 * Answers 404 outside development so the endpoint is indistinguishable from
 * not existing in production.
 */
async function devLogin(req, res, next) {
  try {
    if (env.NODE_ENV !== 'development') {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Not found' });
    }

    const { email } = req.body || {};
    const user = email ? findByEmail(email) : null;

    if (!user) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Unknown dev account' });
    }

    /**
     * Never password-less into a live government mailbox.
     *
     * Dev login exists so a developer can switch between seeded demo accounts.
     * The NICeMail Front Office is not one: its inbox is the real .gov.in
     * mailbox the browser agent reads, and its session can make that agent
     * send. NODE_ENV defaults to "development" and the server listens on every
     * interface, so before this check anyone who could reach the port could
     * POST that address here and read official mail. It signs in with a
     * password like any account whose data is real.
     */
    if (user.id === nicFrontOfficeUser()?.id) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: user.id,
        actorRole: user.role,
        result: AUDIT_RESULTS.DENIED,
        details: { devLogin: true, reason: 'the NICeMail Front Office requires a password' },
      });
      return res
        .status(HTTP_STATUS.FORBIDDEN)
        .json({ error: 'This account reads a live NICeMail mailbox. Sign in with a password.' });
    }

    const publicUser = toPublicUser(user);

    await audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: publicUser.id,
      actorRole: publicUser.role,
      details: { devLogin: true },
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(publicUser), cookieOptions());
    return res.status(HTTP_STATUS.OK).json({ user: publicUser });
  } catch (error) {
    return next(error);
  }
}

export { login, logout, me, users, devLogin };
