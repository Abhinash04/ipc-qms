import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import {
  roleSchema,
  rejectSchema,
  emptySchema,
  createSchema,
  updateSchema,
  passwordSchema,
} from '../validators/userAdminSchemas.js';
import {
  listAccounts,
  approveAccount,
  rejectAccount,
  deactivateAccount,
  reactivateAccount,
  changeAccountRole,
  createAccount,
  updateAccount,
  resetAccountPassword,
} from '../controllers/userAdminController.js';

const router = express.Router();
const administrators = [verifyToken, verifyRole(ADMIN_ROLES)];

router.get('/admin/users', ...administrators, listAccounts);
router.post('/admin/users', ...administrators, validateBody(createSchema), createAccount);
router.patch('/admin/users/:userId', ...administrators, validateBody(updateSchema), updateAccount);
router.post('/admin/users/:userId/password', ...administrators, validateBody(passwordSchema), resetAccountPassword);
router.post('/admin/users/:userId/approve', ...administrators, validateBody(roleSchema), approveAccount);
router.post('/admin/users/:userId/reject', ...administrators, validateBody(rejectSchema), rejectAccount);
router.post('/admin/users/:userId/deactivate', ...administrators, validateBody(emptySchema), deactivateAccount);
router.post('/admin/users/:userId/reactivate', ...administrators, validateBody(emptySchema), reactivateAccount);
router.post('/admin/users/:userId/role', ...administrators, validateBody(roleSchema), changeAccountRole);

export default router;
