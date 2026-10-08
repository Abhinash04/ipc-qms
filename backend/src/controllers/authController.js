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
  addUser,
} from '../services/auth/userDirectory.js';
import * as audit from '../services/audit/auditService.js';
import { AUDIT_ACTIONS, AUDIT_RESULTS } from '../constants/auditActions.js';
import { ACTOR_TYPES } from '../constants/roles.js';
import { nicFrontOfficeUser } from '../constants/users.js';
import { verifyGoogleToken } from '../services/auth/googleAuthService.js';
import { User } from '../models/User.js';
import { isConnected } from '../config/db.js';

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

function me(req, res) {
  const user = findById(req.user.id);

  if (!user) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Authentication required' });
  }

  return res.status(HTTP_STATUS.OK).json({ user: toPublicUser(user) });
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

async function register(req, res, next) {
  try {
    const { name, email, department, designation, password, confirmPassword } = req.body || {};

    // 1. Required fields validation
    if (
      !name ||
      !String(name).trim() ||
      !email ||
      !String(email).trim() ||
      !department ||
      !String(department).trim() ||
      !designation ||
      !String(designation).trim() ||
      !password ||
      !confirmPassword
    ) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ success: false, message: 'All required fields must be provided' });
    }

    // 2. Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ success: false, message: 'Please enter a valid email address' });
    }

    // 3. Password match validation
    if (password !== confirmPassword) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ success: false, message: 'Password and confirm password must match' });
    }

    // 4. Check existing user in MongoDB or directory
    const existingDirectoryUser = findByEmail(normalizedEmail);
    let existingDbUser = null;

    if (isConnected()) {
      try {
        existingDbUser = await User.findOne({ email: normalizedEmail });
      } catch {
        existingDbUser = null;
      }
    }

    if (existingDirectoryUser || existingDbUser) {
      return res
        .status(HTTP_STATUS.CONFLICT)
        .json({ success: false, message: 'An account with this email already exists' });
    }

    // 5. Hash password with bcryptjs
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 6. Map designation to QMS role for dashboard routing
    const designationNorm = String(designation).trim().toLowerCase();
    const designationRoleMap = {
      'officer-in-charge': 'OFFICER_IN_CHARGE',
      'officer in charge': 'OFFICER_IN_CHARGE',
      'assigned official': 'ASSIGNED_OFFICIAL',
      'reviewer': 'REVIEWER',
      'admin': 'ADMIN',
      'super admin': 'SUPER_ADMIN',
    };
    const assignedRole = designationRoleMap[designationNorm] || 'Inquirer';

    // 7. Create user in MongoDB / Directory
    const userId = `USR-${randomUUID().slice(0, 8)}`;
    const userData = {
      userId,
      id: userId,
      name: String(name).trim(),
      email: normalizedEmail,
      department: String(department).trim(),
      designation: String(designation).trim(),
      password: hashedPassword,
      role: assignedRole,
      isActive: true,
      active: true,
    };

    if (isConnected()) {
      await User.create(userData);
    }
    addUser(userData);

    // 7. Success response
    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Account created successfully',
    });
  } catch (error) {
    if (error?.code === 11000 || (error?.name === 'MongoServerError' && error?.code === 11000)) {
      return res
        .status(HTTP_STATUS.CONFLICT)
        .json({ success: false, message: 'An account with this email already exists' });
    }
    return next(error);
  }
}

export { login, logout, me, users, devLogin, googleLogin, register };
