import bcrypt from 'bcryptjs';
import HTTP_STATUS from '../constants/httpStatus.js';
import env from '../config/env.js';
import authConfig, { cookieOptions } from '../config/authConfig.js';
import { isConnected } from '../config/db.js';
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
import { ACTOR_TYPES, ROLES } from '../constants/roles.js';
import { nicFrontOfficeUser } from '../constants/users.js';
import { User } from '../models/User.js';
import { verifyGoogleToken } from '../services/auth/googleAuthService.js';

const registeredInMemoryUsers = new Map();

async function findRegisteredUserByEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;

  if (registeredInMemoryUsers.has(wanted)) {
    return registeredInMemoryUsers.get(wanted);
  }

  if (isConnected() && User?.db?.readyState === 1) {
    const mongoUser = await User.findOne({ email: wanted }).maxTimeMS(1000).exec().catch(() => null);
    if (mongoUser) {
      return {
        id: mongoUser.userId || mongoUser._id?.toString(),
        userId: mongoUser.userId,
        name: mongoUser.name,
        email: mongoUser.email,
        role: mongoUser.role,
        divisionId: mongoUser.divisionId || null,
        password: mongoUser.password,
      };
    }
  }

  return null;
}

async function findRegisteredUserById(id) {
  if (!id) return null;

  for (const user of registeredInMemoryUsers.values()) {
    if (user.id === id || user.userId === id) return user;
  }

  if (isConnected() && User?.db?.readyState === 1) {
    const mongoUser = await User.findOne({ userId: id }).maxTimeMS(1000).exec().catch(() => null);
    if (mongoUser) {
      return {
        id: mongoUser.userId || mongoUser._id?.toString(),
        userId: mongoUser.userId,
        name: mongoUser.name,
        email: mongoUser.email,
        role: mongoUser.role,
        divisionId: mongoUser.divisionId || null,
      };
    }
  }

  return null;
}
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      throw Object.assign(new Error('"email" and "password" are required'), {
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    const normalisedEmail = String(email || '').trim().toLowerCase();

    const registeredUser = await findRegisteredUserByEmail(normalisedEmail);
    let user = null;

    if (registeredUser && registeredUser.password) {
      const passwordMatches = await bcrypt.compare(String(password || ''), registeredUser.password);
      if (passwordMatches) {
        user = toPublicUser({
          id: registeredUser.userId || registeredUser.id,
          name: registeredUser.name,
          email: registeredUser.email,
          role: registeredUser.role,
          divisionId: registeredUser.divisionId || null,
        });
      }
    }

    if (!user) {
      user = await verifyCredentials(email, password);
    }

    if (!user) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        result: AUDIT_RESULTS.DENIED,
        actorType: ACTOR_TYPES.HUMAN,
        details: { email: normalisedEmail },
      });

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

function logout(req, res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(authConfig.COOKIE_NAME, options);
  return res.status(HTTP_STATUS.OK).json({ ok: true });
}

async function me(req, res) {
  const user = findById(req.user.id) || (await findRegisteredUserById(req.user.id)) || req.user;

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

async function register(req, res, next) {
  try {
    const { name, email, department, designation = '', password, confirmPassword, role } = req.body || {};
    if (!name || !email || !department || !password || !confirmPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'All fields are required.',
      });
    }

    const normalisedEmail = String(email || '').trim().toLowerCase();
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(normalisedEmail)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    if (password !== confirmPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Password and Confirm Password do not match.',
      });
    }

    const validRoles = Object.values(ROLES);
    const assignedRole = role && validRoles.includes(role) ? role : (ROLES.INQUIRER || 'INQUIRER');

    const existingInMemory = registeredInMemoryUsers.has(normalisedEmail);
    const existingInDir = findByEmail(normalisedEmail);
    let existingInDb = null;
    if (isConnected() && User?.db?.readyState === 1) {
      existingInDb = await User.findOne({ email: normalisedEmail }).exec().catch(() => null);
    }

    if (existingInDb || existingInDir || existingInMemory) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `USR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    registeredInMemoryUsers.set(normalisedEmail, {
      userId,
      name: String(name).trim(),
      email: normalisedEmail,
      department: String(department).trim(),
      designation: String(designation).trim(),
      password: hashedPassword,
      role: assignedRole,
      active: true,
      isActive: true,
    });

    if (isConnected()) {
      const newUser = new User({
        userId,
        name: String(name).trim(),
        email: normalisedEmail,
        department: String(department).trim(),
        designation: String(designation).trim(),
        password: hashedPassword,
        role: assignedRole,
        active: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await newUser.save();
    }

    await audit.record({
      action: 'USER_REGISTERED',
      actorType: ACTOR_TYPES.HUMAN,
      actorId: userId,
      actorRole: assignedRole,
      details: { email: normalisedEmail, name: String(name).trim() },
    }).catch(() => {});

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Account created successfully',
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }
    return next(error);
  }
}

async function googleAuth(req, res, next) {
  try {
    const { credential, department } = req.body || {};

    if (!credential) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        code: 'MISSING_CREDENTIAL',
        message: 'Google credential is required',
      });
    }

    let verifiedPayload;
    try {
      verifiedPayload = await verifyGoogleToken(credential);
    } catch (err) {
      if (err.code === 'GOOGLE_NOT_CONFIGURED') {
        return res.status(503).json({
          success: false,
          code: 'GOOGLE_NOT_CONFIGURED',
          message: err.message || 'Google Sign Up is not configured yet.',
        });
      }
      return res.status(err.statusCode || HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        code: err.code || 'INVALID_TOKEN',
        message: err.message || 'Invalid or expired Google token',
      });
    }

    const { sub: googleId, email: googleEmail, name: googleName, picture: googlePicture } = verifiedPayload;
    const normalisedEmail = String(googleEmail || '').trim().toLowerCase();

    let existingUserInDb = null;
    let existingInMemory = null;

    if (isConnected()) {
      existingUserInDb = await User.findOne({ googleId }).exec().catch(() => null);
    }

    if (!existingUserInDb) {
      for (const u of registeredInMemoryUsers.values()) {
        if (u.googleId === googleId) {
          existingInMemory = u;
          break;
        }
      }
    }

    if (existingUserInDb || existingInMemory) {
      const found = existingUserInDb || existingInMemory;
      const publicUser = toPublicUser({
        id: found.userId || found.id || found._id?.toString(),
        userId: found.userId || found.id,
        name: found.name,
        email: found.email,
        role: found.role,
        department: found.department,
        divisionId: found.divisionId || null,
        profilePicture: found.profilePicture || googlePicture || '',
        authProvider: 'google',
      });

      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
        actorType: ACTOR_TYPES.HUMAN,
        actorId: publicUser.id,
        actorRole: publicUser.role,
        details: { authProvider: 'google' },
      }).catch(() => {});

      res.cookie(authConfig.COOKIE_NAME, signToken(publicUser), cookieOptions());
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        user: publicUser,
      });
    }

    let userByEmailInDb = null;
    if (isConnected()) {
      userByEmailInDb = await User.findOne({ email: normalisedEmail }).exec().catch(() => null);
    }
    const userByEmailInMemory = registeredInMemoryUsers.get(normalisedEmail) || findByEmail(normalisedEmail);

    if (userByEmailInDb || userByEmailInMemory) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        code: 'LOCAL_ACCOUNT_EXISTS',
        message: 'An account with this email already exists. Please sign in using your existing account.',
      });
    }

    const selectedDept = String(department || '').trim();
    if (!selectedDept) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        code: 'DEPARTMENT_REQUIRED',
        message: 'Please select a Department to complete registration.',
      });
    }

    const userId = `USR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const assignedRole = ROLES.INQUIRER || 'INQUIRER';

    const newUserObj = {
      userId,
      name: String(googleName).trim(),
      email: normalisedEmail,
      department: selectedDept,
      designation: '',
      password: null,
      role: assignedRole,
      authProvider: 'google',
      googleId,
      profilePicture: googlePicture || '',
      active: true,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registeredInMemoryUsers.set(normalisedEmail, newUserObj);

    if (isConnected()) {
      const newUserDoc = new User(newUserObj);
      await newUserDoc.save();
    }

    await audit.record({
      action: 'USER_REGISTERED',
      actorType: ACTOR_TYPES.HUMAN,
      actorId: userId,
      actorRole: assignedRole,
      details: { email: normalisedEmail, name: String(googleName).trim(), authProvider: 'google' },
    }).catch(() => {});

    const publicUser = toPublicUser({
      id: userId,
      userId,
      name: newUserObj.name,
      email: newUserObj.email,
      role: newUserObj.role,
      department: newUserObj.department,
      divisionId: null,
      profilePicture: newUserObj.profilePicture,
      authProvider: 'google',
    });

    res.cookie(authConfig.COOKIE_NAME, signToken(publicUser), cookieOptions());
    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Account created successfully',
      user: publicUser,
    });
  } catch (error) {
    return next(error);
  }
}

export function resetRegisteredUsers() {
  registeredInMemoryUsers.clear();
}

export { login, logout, me, users, devLogin, register, googleAuth };

