import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';
import authConfig, { cookieOptions } from '../config/authConfig.js';
import { signToken, newSessionId, verifyToken as decodeToken } from '../services/auth/tokenService.js';
import { setContextUser } from '../services/audit/requestContext.js';
import {
  verifyCredentials,
  findByEmail,
  findById,
  listUsers,
  toPublicUser,
  findApprovedById,
} from '../services/auth/userDirectory.js';
import { BCRYPT_ROUNDS } from '../services/auth/credentials.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { nicFrontOfficeUser } from '../constants/users.js';
import { verifyGoogleToken } from '../services/auth/googleAuthService.js';
import { User } from '../models/User.js';
import { isConnected } from '../config/db.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt reads only the first 72 bytes; a longer password would match any password sharing them.
const MAX_PASSWORD_BYTES = 72;
const PENDING_APPROVAL = 'Your account is awaiting approval by an administrator.';

const badRequest = (res, message) =>
  res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message });

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
        details: { email: String(email).trim().toLowerCase(), reason: 'invalid email or password' },
      });

      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Invalid email or password' });
    }

    if (user.pending) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        result: AUDIT_RESULTS.DENIED,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: user.id,
        details: { email: user.email, reason: 'account awaiting approval' },
      });

      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: PENDING_APPROVAL });
    }

    const sessionId = startSession(user);
    await audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: user.id,
      actorRole: user.role,
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(user, sessionId), cookieOptions());
    return res.status(HTTP_STATUS.OK).json({ user });
  } catch (error) {
    return next(error);
  }
}

/** Opens a session: its ID goes into the token and onto this request's audit events. */
function startSession(user) {
  const sessionId = newSessionId();
  setContextUser({ ...user, sessionId });
  return sessionId;
}

async function logout(req, res, next) {
  try {
    const user = decodeToken(req.cookies?.[authConfig.COOKIE_NAME]);
    if (user) {
      setContextUser(user);
      await audit.record({
        action: AUDIT_ACTIONS.LOGOUT,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: user.id,
        actorRole: user.role,
      });
    }
    const { maxAge, ...options } = cookieOptions();
    res.clearCookie(authConfig.COOKIE_NAME, options);
    return res.status(HTTP_STATUS.OK).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const builtIn = findById(req.user.id);
    const user = builtIn ? toPublicUser(builtIn) : await findApprovedById(req.user.id);

    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Authentication required' });
    }

    return res.status(HTTP_STATUS.OK).json({ user });
  } catch (error) {
    return next(error);
  }
}

function users(req, res) {
  return res.status(HTTP_STATUS.OK).json({ users: listUsers() });
}

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
    const sessionId = startSession(publicUser);

    await audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: publicUser.id,
      actorRole: publicUser.role,
      details: { devLogin: true },
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(publicUser, sessionId), cookieOptions());
    return res.status(HTTP_STATUS.OK).json({ user: publicUser });
  } catch (error) {
    return next(error);
  }
}

async function googleLogin(req, res, next) {
  try {
    const { credential } = req.body || {};

    if (!credential) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ code: 'MISSING_CREDENTIAL', error: 'Google credential is required' });
    }

    let google;
    try {
      google = await verifyGoogleToken(credential);
    } catch (error) {
      if (!error.statusCode) throw error;
      return res.status(error.statusCode).json({ code: error.code, error: error.message });
    }

    const email = String(google.email).trim().toLowerCase();
    const user = findByEmail(email);

    if (!user) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        result: AUDIT_RESULTS.DENIED,
        actorType: ACTOR_TYPES.HUMAN,
        details: { email, authProvider: 'google', reason: 'no staff account uses this email' },
      });
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: 'NO_ACCOUNT',
        error: 'No BRIDGETECH account uses this Google email. Sign in with your BRIDGETECH email and password.',
      });
    }

    const publicUser = toPublicUser(user);
    const sessionId = startSession(publicUser);

    await audit.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      actorType: ACTOR_TYPES.HUMAN,
      actorId: publicUser.id,
      actorRole: publicUser.role,
      details: { authProvider: 'google' },
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(publicUser, sessionId), cookieOptions());
    return res.status(HTTP_STATUS.OK).json({ user: publicUser });
  } catch (error) {
    return next(error);
  }
}

/**
 * Self-registration. The account is stored with the designation the person asked for but no
 * role, so it cannot sign in until an administrator approves it and gives it one. A role is
 * never taken from the request: anyone can reach this endpoint.
 */
async function register(req, res, next) {
  try {
    const { name, email, department, designation, password, confirmPassword } = req.body || {};
    const text = (value) => (typeof value === 'string' ? value.trim() : '');

    if (!text(name) || !text(email) || !text(department) || !text(designation) || !password || !confirmPassword) {
      return badRequest(res, 'All required fields must be provided');
    }

    const normalizedEmail = text(email).toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return badRequest(res, 'Please enter a valid email address');
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return badRequest(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      return badRequest(res, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
    }

    if (password !== confirmPassword) {
      return badRequest(res, 'Password and confirm password must match');
    }

    if (!isConnected()) {
      return res
        .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
        .json({ success: false, message: 'Sign-up is unavailable while the database is offline' });
    }

    const exists = findByEmail(normalizedEmail) || (await User.exists({ email: normalizedEmail }));
    if (exists) {
      return res
        .status(HTTP_STATUS.CONFLICT)
        .json({ success: false, message: 'An account with this email already exists' });
    }

    await User.create({
      userId: `USR-${randomUUID().slice(0, 8)}`,
      name: text(name),
      email: normalizedEmail,
      department: text(department),
      designation: text(designation),
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: null,
      active: true,
    });

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: `Account created. ${PENDING_APPROVAL}`,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res
        .status(HTTP_STATUS.CONFLICT)
        .json({ success: false, message: 'An account with this email already exists' });
    }
    return next(error);
  }
}

export { login, logout, me, users, devLogin, googleLogin, register };
