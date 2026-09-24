import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import { verifyRole } from '../middleware/verifyRole.js';
import validateBody from '../middleware/validateBody.js';
import validateQuery from '../middleware/validateQuery.js';
import { ROLES } from '../constants/roles.js';
import {
  mailboxDecisionSchema,
  acceptMessageSchema,
  listMessagesQuerySchema,
} from '../validators/mailboxSchemas.js';
import {
  listMessages,
  receiveMessage,
  markIngested,
  deleteMessage,
  resetMailbox,
  decideMessage,
  acceptMessage,
  listDecisions,
  getMessage,
  downloadMessageAttachment,
  markRead,
  syncMailbox,
  rescueMessage,
} from '../controllers/mailboxController.js';

const router = express.Router();

const FRONT_OFFICE_ONLY = [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN];

router.get(
  '/mailbox/messages',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateQuery(listMessagesQuerySchema),
  listMessages,
);

router.get('/mailbox/messages/:messageId', verifyToken, verifyRole(FRONT_OFFICE_ONLY), getMessage);
router.get(
  '/mailbox/messages/:messageId/attachments/:attachmentId',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  downloadMessageAttachment,
);

router.post('/mailbox/messages/:messageId/read', verifyToken, verifyRole(FRONT_OFFICE_ONLY), markRead);

router.post(
  '/mailbox/messages/:messageId/triage/rescue',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  rescueMessage,
);

router.post('/mailbox/sync', verifyToken, verifyRole(FRONT_OFFICE_ONLY), syncMailbox);

router.post('/mailbox/receive', verifyToken, verifyRole(ROLES.SUPER_ADMIN), receiveMessage);

router.post(
  '/mailbox/messages/:messageId/ingested',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  markIngested,
);

router.post(
  '/mailbox/messages/:messageId/decision',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateBody(mailboxDecisionSchema),
  decideMessage,
);

router.post(
  '/mailbox/messages/:messageId/accept',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  validateBody(acceptMessageSchema),
  acceptMessage,
);

router.get('/mailbox/decisions', verifyToken, verifyRole(FRONT_OFFICE_ONLY), listDecisions);

router.delete(
  '/mailbox/messages/:messageId',
  verifyToken,
  verifyRole(FRONT_OFFICE_ONLY),
  deleteMessage,
);

router.delete('/mailbox', verifyToken, verifyRole(ROLES.SUPER_ADMIN), resetMailbox);

export default router;
