import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole, verifyAction } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import {
  getConfig,

  sendAcknowledgement,
  forwardQuery,
  sendResponse,
} from '../controllers/emailController.js';

const router = express.Router();

router.get('/emails/config', verifyToken, getConfig);
router.post(
  '/emails/acknowledgement',
  verifyToken,
  verifyRole(ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN),
  sendAcknowledgement,
);
router.post('/emails/forward', verifyToken, verifyAction(WORKFLOW_ACTION.FORWARD), forwardQuery);
router.post('/emails/response', verifyToken, verifyAction(WORKFLOW_ACTION.DISPATCH), sendResponse);

export default router;
