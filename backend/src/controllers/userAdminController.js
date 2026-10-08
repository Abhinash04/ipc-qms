import HTTP_STATUS from '../constants/httpStatus.js';
import * as registrations from '../services/auth/registrationService.js';

const handle = (run) => async (req, res, next) => {
  try {
    return await run(req, res);
  } catch (error) {
    return next(error);
  }
};

const respond = (res, account, message) => res.status(HTTP_STATUS.OK).json({ account, message });

export const listAccounts = handle(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(await registrations.listAccounts());
});

export const approveAccount = handle(async (req, res) =>
  respond(
    res,
    await registrations.approve(req.user, req.params.userId, req.body.role, req.body),
    'User approved successfully. The account is now active and can log in with the registered credentials.',
  ),
);

export const rejectAccount = handle(async (req, res) =>
  respond(res, await registrations.reject(req.user, req.params.userId, req.body.reason), 'Registration request rejected.'),
);

export const deactivateAccount = handle(async (req, res) =>
  respond(res, await registrations.deactivate(req.user, req.params.userId), 'Account deactivated. It can no longer sign in.'),
);

export const reactivateAccount = handle(async (req, res) =>
  respond(res, await registrations.reactivate(req.user, req.params.userId), 'Account reactivated. It can sign in again.'),
);

export const changeAccountRole = handle(async (req, res) =>
  respond(res, await registrations.changeRole(req.user, req.params.userId, req.body.role, req.body), 'Role updated.'),
);

export const createAccount = handle(async (req, res) => {
  const account = await registrations.create(req.user, req.body);
  res.status(HTTP_STATUS.CREATED).json({ account, message: 'User created. They can sign in with the password you set.' });
});

export const updateAccount = handle(async (req, res) =>
  respond(res, await registrations.update(req.user, req.params.userId, req.body), 'User updated.'),
);

export const resetAccountPassword = handle(async (req, res) =>
  respond(
    res,
    await registrations.resetPassword(req.user, req.params.userId, req.body.password, req.body.confirmPassword),
    'Password reset. Sessions signed in with the old password have ended.',
  ),
);
