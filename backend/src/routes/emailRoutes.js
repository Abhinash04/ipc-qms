import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole, verifyAction } from '../middleware/verifyRole.js';
import { ROLES } from '../constants/roles.js';
import { WORKFLOW_ACTION } from '../constants/workflowActions.js';
import {
  getConfig,
  sendEnquiry,
  sendAcknowledgement,
  forwardQuery,
  sendResponse,
} from '../controllers/emailController.js';

const router = express.Router();

// Returns the participant directory (names + addresses), so it needs a session
// even though it is not role-specific.
router.get('/emails/config', verifyToken, getConfig);

// Sends as the INQUIRER identity — only an inquirer may trigger it.
router.post(
  '/emails/enquiry',
  verifyToken,
  verifyRole(ROLES.INQUIRER, ROLES.SUPER_ADMIN),
  sendEnquiry,
);

router.post(
  '/emails/acknowledgement',
  verifyToken,
  verifyRole(ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN),
  sendAcknowledgement,
);

router.post('/emails/forward', verifyToken, verifyAction(WORKFLOW_ACTION.FORWARD), forwardQuery);

// The dispatch path. Note it accepts arbitrary attachmentIds and an arbitrary
// recipient, so it doubles as a read-by-mailing path for stored documents —
// which is why it is restricted to the roles that may dispatch at all.
router.post('/emails/response', verifyToken, verifyAction(WORKFLOW_ACTION.DISPATCH), sendResponse);

export default router;
